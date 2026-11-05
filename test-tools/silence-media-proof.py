"""Local media proof for the web planner and the unchanged authoritative renderer."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'worker'))
from shorts_worker.caption_templates import compile_caption_render_spec
from shorts_worker.config import Settings
from shorts_worker.editor_renderer import EditorDocumentRenderer, retime_editor_subtitles
from shorts_worker.render_spec_v4 import compile_initial_editor_render_spec_v4
from shorts_worker.schemas import EditorDocument, VideoAspectRatio
from shorts_worker.subtitles import TranscriptWord

mode, folder = sys.argv[1], Path(sys.argv[2])
folder.mkdir(parents=True, exist_ok=True)
def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=120, shell=False)

if mode == 'prepare':
    offset = float(sys.argv[3]) if len(sys.argv) > 3 else 0
    language = sys.argv[4] if len(sys.argv) > 4 else 'ko'
    labels = {'ko': ['첫말', '다음말', '끝말'], 'en': ['First', 'Next', 'Last'], 'ja': ['最初', '次の言葉', '最後']}[language]
    source = folder / 'source.mp4'
    run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=12',
         '-f','lavfi','-i','aevalsrc=0.15*sin(2*PI*440*t)*(between(t\\,0\\,3)+between(t\\,5\\,8)+between(t\\,10\\,12)):s=48000:d=12',
         '-c:v','libx264','-preset','ultrafast','-c:a','aac','-movflags','+faststart',str(source)])
    detected = run(['ffmpeg','-hide_banner','-nostats','-i',str(source),'-vn','-af','silencedetect=noise=-30dB:d=0.30','-f','null','-'])
    spec = importlib.util.spec_from_file_location('silence_analyzer', root/'web/private/shorts-silence/analyze.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    silences = module.parse_silences(detected.stderr,0,12)
    words = [TranscriptWord(text=t,start=a,end=b,provider='elevenlabs') for t,a,b in zip(labels, [.5,5.5,10.5], [1.5,6.5,11.5])]
    captions = compile_caption_render_spec(words,template_id='pop',clip_start=0,clip_end=12,video_aspect_ratio=VideoAspectRatio.LANDSCAPE,schema_version=4)
    render_spec = compile_initial_editor_render_spec_v4(title='무음 테스트',template_id='dark-minimal',video_aspect_ratio='16:9',font_scale=1,caption_render_spec=captions)
    value = {'short':{'id':'77777777-7777-4777-8777-777777777777','renderVersion':1,'templateId':'dark-minimal','customTemplateId':None,'templateSnapshot':{'presetVersion':3},'videoAspectRatio':'16:9','hookTitle':'무음 테스트','channelDisplayName':'테스트','titleTextStyles':[],'initialRenderSpec':render_spec,'subtitlesEnabled':True,'commentOverlays':[],'startSeconds':offset,'endSeconds':offset+12},
             'timeline':{'start':offset,'end':offset+12,'subtitles':[{'start':w.start,'end':w.end,'text':w.text} for w in words]},'silences':silences,'captions':captions}
    (folder/'input.json').write_text(json.dumps(value,ensure_ascii=False))
    print(json.dumps({'silences':silences,'sourceSeconds':12}))
elif mode == 'render':
    source = json.loads((folder/'input.json').read_text())
    plan = json.loads((folder/'plan.json').read_text())
    document = EditorDocument.model_validate(plan['document'])
    segments = retime_editor_subtitles(document,source['captions'])
    assert len(segments) >= 3
    assert [s.text for s in segments] == [s["text"] for s in source["timeline"]["subtitles"]]
    assert 3 < segments[1].start < 4.5, segments
    assert segments[-1].end < 9, segments
    output = folder/'output.mp4'
    settings = Settings(temp_dir=folder,ffmpeg_threads=1)
    renderer = EditorDocumentRenderer(settings)
    sequence = renderer.extract_sequence(timeline_path=folder/'source.mp4',output_path=folder/'sequence.mp4',document=document,work_dir=folder/'sequence')
    renderer.render(clean_path=sequence,output_path=output,document=document,work_dir=folder/'render',channel_thumbnail_path=None,caption_render_spec=source['captions'])
    probe = json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(output)]).stdout)
    duration = float(probe['format']['duration'])
    assert abs(duration - plan['outputSeconds']) < .08, (duration,plan)
    assert {s['codec_type'] for s in probe['streams']} >= {'audio','video'}
    print(json.dumps({'outputSeconds':duration,'cutCount':plan['cutCount'],'removedSeconds':plan['removedSeconds'],'subtitleStarts':[s.start for s in segments],'codecs':[s.get('codec_name') for s in probe['streams']]}))
else:
    raise SystemExit('Unknown proof stage')
