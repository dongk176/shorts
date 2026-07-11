from __future__ import annotations

import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import Settings
from .database import JobDatabase
from .errors import ShortsMakerError
from .ingestion import IngestionProvider, YtDlpIngestionProvider
from .pipeline import JobManager, JobPipeline
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    CreateJobRequest,
    CreateJobResponse,
    EditOutputRequest,
    HighlightClip,
    JobResponse,
    JobStatus,
    OutputItem,
    TemplateId,
)
from .selector import clip_count_for_duration


def resolve_storage_file(storage_root: Path, requested_path: str) -> Path:
    if not requested_path or "\x00" in requested_path:
        raise FileNotFoundError
    relative = Path(requested_path)
    if relative.parts and relative.parts[0] == "_sources":
        raise FileNotFoundError
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise FileNotFoundError
    root = storage_root.resolve()
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise FileNotFoundError from exc
    if candidate.suffix.lower() != ".mp4" or not candidate.is_file():
        raise FileNotFoundError
    return candidate


def create_app(
    *,
    settings: Settings | None = None,
    ingestion_provider: IngestionProvider | None = None,
) -> FastAPI:
    configured = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configured.ensure_directories()
        database = JobDatabase(configured.database_path)
        database.initialize()
        database.recover_interrupted_jobs()
        ingestion = ingestion_provider or YtDlpIngestionProvider(
            timeout_seconds=configured.download_timeout_seconds
        )
        pipeline = JobPipeline(
            settings=configured,
            database=database,
            ingestion=ingestion,
        )
        manager = JobManager(pipeline, configured.max_concurrent_jobs)
        app.state.settings = configured
        app.state.database = database
        app.state.ingestion = ingestion
        app.state.job_manager = manager
        yield
        manager.shutdown()

    app = FastAPI(
        title="Shorts Maker API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(configured.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(ShortsMakerError)
    async def application_error_handler(_: Request, exc: ShortsMakerError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        message = "요청 값을 확인해 주세요."
        if errors:
            detail = str(errors[0].get("msg", ""))
            if detail.startswith("Value error, "):
                detail = detail.removeprefix("Value error, ")
            if detail and "Input should be" not in detail:
                message = detail
        return JSONResponse(status_code=422, content={"detail": message})

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/analyze", response_model=AnalyzeResponse)
    async def analyze(payload: AnalyzeRequest, request: Request) -> AnalyzeResponse:
        metadata = await run_in_threadpool(
            request.app.state.ingestion.analyze_url, payload.youtube_url
        )
        clip_count_for_duration(
            metadata.duration_seconds,
            maximum_seconds=configured.max_video_duration_seconds,
        )
        return AnalyzeResponse(
            video_id=metadata.video_id,
            title=metadata.title,
            channel_name=metadata.channel_name,
            thumbnail_url=metadata.thumbnail_url,
            duration_seconds=metadata.duration_seconds,
        )

    @app.post("/api/jobs", response_model=CreateJobResponse, status_code=202)
    async def create_job(payload: CreateJobRequest, request: Request) -> CreateJobResponse:
        if not payload.rights_confirmed:
            raise HTTPException(
                status_code=400,
                detail="소유하거나 사용 허가를 받은 영상인지 확인해 주세요.",
            )
        metadata = await run_in_threadpool(
            request.app.state.ingestion.analyze_url, payload.youtube_url
        )
        range_end = (
            metadata.duration_seconds
            if payload.range_end_seconds is None
            else payload.range_end_seconds
        )
        if range_end > metadata.duration_seconds or range_end <= payload.range_start_seconds:
            raise HTTPException(
                status_code=400,
                detail="사용 구간의 시작과 끝을 영상 길이 안에서 올바르게 선택해 주세요.",
            )
        clip_count_for_duration(
            range_end - payload.range_start_seconds,
            maximum_seconds=configured.max_video_duration_seconds,
        )
        job_id = uuid4().hex
        request.app.state.database.create_job(
            job_id,
            payload.youtube_url,
            payload.template_id.value,
            payload.range_start_seconds,
            range_end,
        )
        request.app.state.job_manager.submit(job_id, metadata)
        return CreateJobResponse(job_id=job_id, status=JobStatus.QUEUED)

    @app.get("/api/jobs/{job_id}", response_model=JobResponse)
    async def get_job(job_id: str, request: Request) -> JobResponse:
        if len(job_id) != 32 or any(character not in "0123456789abcdef" for character in job_id):
            raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
        job = request.app.state.database.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
        return JobResponse(
            job_id=job_id,
            status=job["status"],
            progress=job["progress"],
            message=job["message"],
            outputs=job["outputs"],
        )

    @app.patch(
        "/api/jobs/{job_id}/outputs/{output_id}", response_model=OutputItem
    )
    async def edit_output(
        job_id: str,
        output_id: str,
        payload: EditOutputRequest,
        request: Request,
    ) -> OutputItem:
        job = request.app.state.database.get_job(job_id)
        if job is None or job["status"] != JobStatus.COMPLETED.value:
            raise HTTPException(status_code=404, detail="완성된 작업을 찾을 수 없습니다.")
        output = next((item for item in job["outputs"] if item["id"] == output_id), None)
        if output is None:
            raise HTTPException(status_code=404, detail="쇼츠를 찾을 수 없습니다.")
        source_relative = job.get("source_path")
        if not source_relative:
            raise HTTPException(
                status_code=409,
                detail="이 쇼츠는 편집용 원본이 없어 새로 생성한 뒤 편집할 수 있습니다.",
            )
        source_path = (configured.storage_dir / source_relative).resolve()
        if not source_path.is_file() or configured.storage_dir.resolve() not in source_path.parents:
            raise HTTPException(status_code=409, detail="편집용 원본을 찾을 수 없습니다.")
        output_path = resolve_storage_file(
            configured.storage_dir, output["video_url"].removeprefix("/files/")
        )
        clip = HighlightClip(
            start_seconds=output["start_seconds"],
            end_seconds=output["end_seconds"],
            hook_title=payload.title,
        )
        edit_dir = configured.temp_dir / f"edit-{job_id}-{output_id.rsplit('-', 1)[-1]}"
        edit_dir.mkdir(parents=True, exist_ok=True)
        edited_output_path = edit_dir / "edited.mp4"
        try:
            await run_in_threadpool(
                request.app.state.job_manager.pipeline.renderer.render,
                source_path=source_path,
                output_path=edited_output_path,
                clip=clip,
                clip_index=int(output_id.rsplit("-", 1)[-1]),
                channel_name=job.get("channel_name") or "YouTube 채널",
                template_id=TemplateId(job["template_id"]),
                transcript=[],
                work_dir=edit_dir,
                title_color=payload.title_color,
                title_font_size=payload.title_font_size,
            )
            edited_output_path.replace(output_path)
        finally:
            shutil.rmtree(edit_dir, ignore_errors=True)
        output.update(
            title=payload.title,
            title_color=payload.title_color.upper(),
            title_font_size=payload.title_font_size,
        )
        request.app.state.database.update_job(job_id, outputs=job["outputs"])
        return OutputItem.model_validate(output)

    @app.get("/files/{file_path:path}")
    async def files(
        file_path: str,
        request: Request,
        download: bool = Query(default=False),
    ) -> FileResponse:
        try:
            path = resolve_storage_file(request.app.state.settings.storage_dir, file_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.") from exc
        disposition = "attachment" if download else "inline"
        return FileResponse(
            path,
            media_type="video/mp4",
            filename=path.name if download else None,
            content_disposition_type=disposition,
            headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
        )

    return app


app = create_app()
