# Data retention

| 데이터 | 위치 | 보관 기간 | 접근 |
| --- | --- | --- | --- |
| 전체 YouTube 원본/추출 오디오/임시 자막 | Prepare Fargate ephemeral `/tmp` | task 동안만 | worker |
| 1080×1080 clean clip | S3 `edit-sources/` | 최초 생성부터 최대 30일 | worker만 |
| 1080×1920 output | S3 `outputs/` | 최초 생성부터 최대 30일 | CloudFront Signed URL |
| thumbnail | S3 `thumbnails/` | output과 동일 | 서버/정리 작업 |
| subtitle segments | Supabase | media 만료까지 | 서버/worker |
| 최소 job/usage metadata | Supabase | 운영 정책에 따라 | 서버/worker |

재렌더링은 `expires_at`을 갱신하지 않습니다. 사용자 삭제는 모든 output version, thumbnail, clean clip을 먼저 지우고 DB를 `deleted`로 바꿉니다. 1분 주기 cleanup은 `expires_at <= now()` 행의 objects를 삭제하고 subtitle segments를 비웁니다. S3 lifecycle 30일은 애플리케이션 cleanup 실패 시에도 파일이 무기한 남지 않게 합니다.

확인은 `aws s3api list-objects-v2 --bucket <bucket> --prefix edit-sources/`와 Supabase `generated_shorts.expires_at/deleted_at`을 함께 비교합니다. 전체 source를 뜻하는 prefix나 object는 설계상 존재하지 않아야 합니다.
