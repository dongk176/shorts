"""Build the private, three-language EasyCut editorial workbook collection.

Source photos are credited in assets/SOURCES.md and in every PDF. Only cover
and sample JPEGs are public. PDFs are staged and validated before publication.
"""
from pathlib import Path
import argparse
import html
import io
from functools import lru_cache
from PIL import Image
import json
import os
import re
import shutil
import subprocess

from fontTools.ttLib import TTFont as VariableFont
from fontTools.varLib.instancer import instantiateVariableFont
from pypdf import PdfReader
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/marketing/shorts-guides'
DATA = json.loads((SOURCE / 'catalog-and-exercises.json').read_text())
CHAPTERS = {}
for line in (SOURCE / 'chapters.tsv').read_text().splitlines():
    slug, number, *texts = line.split('\t')
    assert len(texts) == 9
    CHAPTERS[slug, int(number)] = [texts[:3], texts[3:6], texts[6:]]

W, H, M = 420, 595, 30
INK, PAPER, MUTED, LINE = '#171a20', '#f7f5f0', '#5b6168', '#d8d9d5'
TMP = ROOT / 'tmp/pdfs'
TMP.mkdir(parents=True, exist_ok=True)
FONT_CACHE = TMP / 'fonts'
FONT_CACHE.mkdir(exist_ok=True)
FC_CACHE = TMP / 'fontconfig-cache'
FC_CACHE.mkdir(exist_ok=True)
FC_CONFIG = TMP / 'fonts.conf'
FC_CONFIG.write_text(f'<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>{FONT_CACHE}</dir><cachedir>{FC_CACHE}</cachedir></fontconfig>')
RENDER_ENV = {**os.environ, 'FONTCONFIG_FILE': str(FC_CONFIG)}
for lang, filename in [('ko', 'NotoSansKR-Variable.ttf'), ('ja', 'NotoSansCJKjp-Variable.ttf')]:
    for weight, suffix in [(400, ''), (600, '-bold')]:
        target = FONT_CACHE / f'{lang}{suffix}.ttf'
        if not target.exists():
            font = VariableFont(ROOT / 'web/public/fonts/editor' / filename)
            instantiateVariableFont(font, {'wght': weight}, inplace=True).save(target)
        pdfmetrics.registerFont(TTFont(lang + suffix, str(target)))

PHOTOS = {
    'phone': (SOURCE / 'assets/pexels-17902221.jpg', 'Beyzanur K.', '17902221'),
    'gear': (SOURCE / 'assets/pexels-6093960.jpg', 'Sutharshan Mahendrarajah', '6093960'),
    'camera': (SOURCE / 'assets/pexels-18979898.jpg', 'Masood Aslami', '18979898'),
    'product': (ROOT / 'web/public/images/monetization/affiliate-13250819.webp', 'Amar Preciado', '13250819'),
    'edit': (ROOT / 'web/public/images/monetization/ads-11025645.webp', 'Amar Preciado', '11025645'),
    'craft': (ROOT / 'web/public/images/monetization/sales-6611403.webp', 'Yan Krukau', '6611403'),
}
VISUALS = {
    'first-short': {'photo': 'phone', 'headline': ['첫 쇼츠,\n오늘 완성.', 'Your first\nShort starts\nhere.', '最初の\nショートを\n作ろう。'], 'theme': ['시작을 위한 작은 실습', 'MAKE YOUR FIRST MOVE', 'まずは、小さく作ってみよう'], 'steps': [['질문 하나', '세 장면', '첫 쇼츠'], ['One question', 'Three scenes', 'One Short'], ['一つの疑問', '三つの場面', '1本の動画']]},
    'affiliate': {'photo': 'product', 'headline': ['써본 제품이\n콘텐츠가\n되는 순간.', 'Real products.\nHonest stories.\nYour next step.', '使った商品が\nコンテンツに\n変わる。'], 'theme': ['경험에서 시작하는 제휴 수익', 'EXPERIENCE INTO CONTENT', '自分の体験から始めよう'], 'steps': [['사용 경험', '리뷰 영상', '구매 안내'], ['Experience', 'Honest review', 'Next step'], ['使用体験', 'レビュー', '購入の案内']]},
    'series': {'photo': 'edit', 'headline': ['한 번 보고,\n다시 찾는\n채널.', 'Give them\na reason\nto return.', 'また見たい。\nそう思える\nチャンネルへ。'], 'theme': ['다음 편이 기다려지는 시리즈', 'BUILD A REASON TO RETURN', '次も見たくなるシリーズを'], 'steps': [['같은 시청자', '다른 질문', '다음 편'], ['Same viewer', 'New question', 'Next episode'], ['同じ視聴者', '違う疑問', '次の1本']]},
    'brand': {'photo': 'camera', 'headline': ['작은 채널의\n첫 브랜드\n협업.', 'Small channel.\nStrong idea.\nFirst pitch.', '小さな\nチャンネルの\n初めての案件。'], 'theme': ['샘플부터 제안서까지', 'MAKE YOUR WORK SPEAK', 'サンプルから提案まで'], 'steps': [['시청자 이해', '샘플 영상', '협업 제안'], ['Audience', 'Sample video', 'A clear pitch'], ['視聴者理解', 'サンプル', '協業の提案']]},
    'sales': {'photo': 'craft', 'headline': ['짧은 영상,\n내 일의\n다음 기회.', 'Short video.\nUseful answer.\nNew connection.', '短い動画で、\n自分の仕事を\n届けよう。'], 'theme': ['고객의 질문에서 시작하기', 'TURN QUESTIONS INTO TRUST', 'お客さんの疑問から始めよう'], 'steps': [['고객 질문', '짧은 답변', '상품 안내'], ['A question', 'Useful answer', 'Your offer'], ['お客さんの疑問', '短い答え', '商品の案内']]},
}
T = {
    'roadmap': ['읽고, 만들어보고, 남기기', 'Read it. Make it. Keep it.', '読んで、作って、残そう。'],
    'example': ['이렇게 바꿔보세요', 'TRY THIS APPROACH', 'こんなふうに考えよう'],
    'task': ['이제 내 차례', 'YOUR TURN', '次は、自分の番'],
    'workflow': ['이지컷으로 연결하기', 'Make it with EasyCut', 'EasyCutで形にしよう'],
    'sample': ['세 장면으로 그려보기', 'Think in three scenes', '三つの場面で考えよう'],
    'schedule': ['내 시간에 맞는 리듬', 'Find your own rhythm', '自分のペースを見つけよう'],
    'sheet': ['다음 한 편을 위한 기록', 'Notes for your next Short', '次の1本のためのメモ'],
    'faq': ['막히는 순간, 이 답부터', 'A little help when stuck', '迷ったら、ここを読もう'],
    'sources': ['만들기 전에, 한 번 더', 'Before you hit publish', '公開前に、もう一度。'],
    'open': ['첫 문장', 'OPENING', '最初の一言'], 'scene': ['보여줄 장면', 'THE DEMO', '見せる場面'], 'close': ['마지막 안내', 'NEXT STEP', '最後の案内'],
    'note': ['실습용 구성 예시예요. 사진은 촬영 아이디어를 돕는 참고 이미지이며, 내 경험과 원본에 맞게 바꿔보세요.', 'A practice storyboard. Photos suggest a visual approach; adapt the scenes to your own experience and footage.', '実習用の構成例です。写真は撮影の参考イメージ。自分の経験や素材に合わせて使ってください。'],
    'rights': ['수익이나 플랫폼 승인을 보장하지 않습니다.', 'No income or platform approval is guaranteed.', '収益やプラットフォームの承認を保証するものではありません。'],
    'review': ['내용 확인 2026.09.27 · 디자인 개정판', 'Reviewed 2026-09-27 · Editorial edition', '内容確認 2026.09.27・デザイン改訂版'],
    'result': ['이 책을 덮을 때 남는 것', 'WHAT YOU WILL MAKE', '読み終えたときに残るもの'],
    'chapters': ['다섯 번의 실습', 'FIVE PRACTICAL LESSONS', '五つの実習'],
    'tools': ['바로 쓰는 실습 도구', 'YOUR WORKING TOOLS', 'すぐに使える実習ツール'],
    'write': ['여기에 내 생각을 적어보세요', 'Leave your own notes here', 'ここに自分の考えを書こう'],
}

def clean(text):
    return str(text).replace('–', '-').replace('—', '-').replace('‑', '-')

@lru_cache(maxsize=len(PHOTOS))
def photo_reader(key):
    path = PHOTOS[key][0]
    if path.suffix == '.webp':
        # Embed photos with JPEG compression rather than PDF's lossless RGB stream.
        data = io.BytesIO()
        with Image.open(path) as source:
            source.convert('RGB').save(data, format='JPEG', quality=93, optimize=True)
        data.seek(0)
        return ImageReader(data)
    return ImageReader(str(path))


class Book:
    def __init__(self, slug, locale, index):
        self.slug, self.locale, self.i = slug, locale, index
        self.meta, self.v = DATA['catalog'][slug], VISUALS[slug]
        self.number = list(DATA['catalog']).index(slug) + 1
        self.font = locale if locale != 'en' else 'Helvetica'
        self.bold = locale + '-bold' if locale != 'en' else 'Helvetica-Bold'
        self.accent = self.meta['color']
        self.page, self.used_photos, self.boxes = 0, set(), []
        self.out = TMP / 'staged' / locale / f'{slug}.pdf'
        self.out.parent.mkdir(parents=True, exist_ok=True)
        self.c = canvas.Canvas(str(self.out), pagesize=(W, H), pageCompression=1)
        self.c.setTitle(self.meta['title'][index])
        self.c.setAuthor('EasyCut')
        self.c.setSubject(self.meta['subtitle'][index])
        self.c.setCreator('EasyCut Creator Workbooks / Editorial edition')

    def t(self, key):
        return T[key][self.i]

    def rect(self, x, top, width, height, color, alpha=1):
        self.c.saveState()
        self.c.setFillColor(HexColor(color))
        self.c.setFillAlpha(alpha)
        self.c.rect(x, H - top - height, width, height, fill=1, stroke=0)
        self.c.restoreState()

    def line(self, x1, top, x2, color=LINE, thickness=.6):
        self.c.setStrokeColor(HexColor(color))
        self.c.setLineWidth(thickness)
        self.c.line(x1, H - top, x2, H - top)

    def paragraph(self, text, width, size, bold=False, color=INK, leading=None):
        return Paragraph(html.escape(clean(text)).replace('\n', '<br/>'), ParagraphStyle(
            'text', fontName=self.bold if bold else self.font, fontSize=size,
            leading=leading or size * 1.52, textColor=HexColor(color),
            wordWrap='CJK' if self.locale in ['ja', 'ko'] else None,
            splitLongWords=True, allowWidows=0, allowOrphans=0,
        ))

    def text(self, text, x, top, width, size=10.5, color=INK, bold=False, maxh=None, leading=None, minsize=None):
        original = size
        while True:
            p = self.paragraph(text, width, size, bold, color, leading)
            _, height = p.wrap(width, 2000)
            if maxh is None or height <= maxh + .1:
                break
            size -= .25
            assert size >= (minsize or original), (self.slug, self.locale, self.page, text[:50], height, maxh)
        assert x >= 0 and x + width <= W + .1 and top >= 0 and top + height <= H - 20, (self.slug, self.locale, self.page, text, top, height)
        p.drawOn(self.c, x, H - top - height)
        self.boxes.append({'page': self.page, 'size': size, 'top': round(top, 1), 'bottom': round(top + height, 1)})
        return top + height

    def latin(self, text, x, top, size=8, color=INK, bold=True):
        self.c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
        self.c.setFillColor(HexColor(color))
        self.c.drawString(x, H - top - size, text)

    def photo(self, key, x, top, width, height, focal=(.5, .5)):
        self.used_photos.add(key)
        reader = photo_reader(key)
        iw, ih = reader.getSize()
        scale = max(width / iw, height / ih)
        dw, dh = iw * scale, ih * scale
        left, bottom = x - (dw - width) * focal[0], H - top - height - (dh - height) * (1 - focal[1])
        self.c.saveState()
        path = self.c.beginPath()
        path.rect(x, H - top - height, width, height)
        self.c.clipPath(path, stroke=0)
        self.c.drawImage(reader, left, bottom, dw, dh, mask='auto')
        self.c.restoreState()

    def new(self, title=None, tag=None, dark=False):
        if self.page:
            self.c.showPage()
        self.page += 1
        self.rect(0, 0, W, H, INK if dark else PAPER)
        if self.page == 1:
            return
        fg = '#ffffff' if dark else INK
        self.latin('EASYCUT', M, 22, 9, fg)
        self.latin(f'CREATOR WORKBOOK / {self.number:02d}', 243, 23, 7, '#afb3ba' if dark else MUTED, False)
        self.line(M, 42, W - M, '#3e434a' if dark else LINE)
        self.latin(f'{self.page:02d} / 13', W - M - 32, 567, 7, fg)
        self.text(self.meta['title'][self.i], M, 564, 300, 6.7, '#afb3ba' if dark else MUTED, maxh=11)
        if title:
            self.latin(tag, M, 60, 8, self.accent if dark else MUTED)
            return self.text(title, M, 82, 360, 23, fg, True, maxh=70, minsize=21)

    def cover(self):
        self.new()
        self.photo(self.v['photo'], 0, 0, W, H, (.5, .45))
        self.rect(0, 0, W, H, '#071015', .20)
        # One continuous gradient: no visible seams between title and photo.
        for y in range(0, 596, 2):
            shade = .72 * max(0, 1 - y / 360) + .96 * max(0, (y - 270) / 325) ** 1.1
            self.rect(0, y, W, 2, '#090e13', min(.97, shade))
        self.latin('EasyCut', M, 26, 20, '#ffffff')
        self.latin('CREATOR WORKBOOKS', M, 55, 7.5, '#ffffff')
        self.rect(W - M - 53, 25, 53, 53, self.accent)
        self.latin(f'{self.number:02d}', W - M - 45, 28, 32)
        self.text(self.v['theme'][self.i], M, 101, 355, 9.5, self.accent, True)
        self.text(self.v['headline'][self.i], M - 1, 127, 369, 39 if self.locale == 'en' else 37, '#ffffff', True, maxh=170, leading=46, minsize=34)
        self.rect(M, 361, 36, 4, self.accent)
        self.text(self.meta['title'][self.i], M, 383, 355, 13, '#ffffff', True, maxh=42, minsize=11)
        self.text(self.meta['subtitle'][self.i], M, 434, 348, 10, '#e3e6e9', maxh=34, minsize=9)
        self.line(M, 487, W - M, '#83888f', .5)
        self.text(self.t('result'), M, 504, 350, 8, self.accent, True)
        self.text(self.meta['outcome'][self.i], M, 525, 350, 11, '#ffffff', maxh=35, minsize=10)
        self.latin('FIELD GUIDE / 13 PAGES / ' + self.locale.upper(), M, 573, 6.5, '#c9ccd1', False)

    def roadmap(self):
        self.new(self.t('roadmap'), 'START HERE')
        self.photo(self.v['photo'], 256, 153, 134, 150)
        self.rect(M, 153, 216, 150, INK)
        self.text(self.t('result'), M + 16, 169, 184, 8, self.accent, True)
        self.text(self.meta['outcome'][self.i], M + 16, 195, 180, 16, '#ffffff', True, maxh=76, minsize=14)
        self.text(['한 장씩 읽고, 한 가지씩 해보세요.', 'One page. One practical next step.', '1ページずつ、一つずつ試そう。'][self.i], M + 16, 275, 184, 8, '#d8dce2', maxh=16)
        self.text(self.t('chapters'), M, 322, 350, 9, MUTED, True)
        top = 346
        for n, title in enumerate(self.meta['chapters']):
            self.latin(f'{n + 3:02d}', M, top + 3, 10, INK)
            self.text(title[self.i], M + 30, top, 325, 10, maxh=28, minsize=9)
            self.line(M, top + 32, W - M)
            top += 37
        self.text(self.t('tools'), M, 542, 115, 8, MUTED, True)
        self.text(['08 실습  /  09 콘티  /  10 일정  /  11 기록  /  12 FAQ', '08 Workflow / 09 Scenes / 10 Pace / 11 Notes / 12 FAQ', '08 実践 / 09 構成 / 10 予定 / 11 メモ / 12 FAQ'][self.i], 151, 542, 239, 6.8, MUTED, maxh=13)

    def chapter(self, n):
        title = self.meta['chapters'][n][self.i]
        lesson, example, task = [part[self.i] for part in CHAPTERS[self.slug, n]]
        self.new(title, f'LESSON {n + 1:02d} / 05')
        # Alternate a panorama, a photo-and-note split, and a large type strip.
        image = [self.v['photo'], 'gear', self.v['photo'], 'edit', 'camera'][n]
        if n in (0, 2):
            self.photo(image, M, 162, 360, 119, (.5, .47))
            self.rect(M, 252, 360, 29, INK, .83)
            self.text(self.v['steps'][self.i][n // 2], M + 12, 259, 328, 8.5, '#ffffff', True, maxh=15)
        elif n in (1, 3):
            self.photo(image, M, 162, 160, 119, (.52, .48))
            self.rect(190, 162, 200, 119, self.accent)
            self.latin(f'0{n + 1}', 204, 168, 37)
            self.text(self.v['steps'][self.i][1 if n == 1 else 2], 206, 227, 163, 14, bold=True, maxh=45, minsize=12)
        else:
            self.rect(M, 162, 360, 119, INK)
            for k, text in enumerate(self.v['steps'][self.i]):
                x = M + 14 + k * 118
                self.latin(f'0{k + 1}', x, 179, 25, self.accent)
                self.text(text, x, 224, 102, 10, '#ffffff', True, maxh=36, minsize=9)
                if k < 2:
                    self.latin('>', x + 93, 187, 13, '#737982')
        top = self.text(lesson, M, 299, 360, 10.5, maxh=100, minsize=10, leading=15)
        top += 10
        self.text(self.t('example'), M, top, 355, 8, MUTED, True)
        top += 19
        example_top = top
        top = self.text(example, M + 12, top, 348, 10.25, maxh=80, minsize=9.75, leading=15)
        self.rect(M, example_top, 2, top - example_top, self.accent)
        task_top = max(461, top + 17)
        assert task_top <= 482, (self.slug, self.locale, n, task_top)
        self.rect(M, task_top, 360, 552 - task_top, self.accent)
        self.text(self.t('task'), M + 13, task_top + 11, 333, 8, bold=True)
        self.text(task, M + 13, task_top + 31, 333, 10, maxh=545 - task_top - 31, minsize=9.25)

    def workflow(self, strategy):
        self.new(self.t('workflow'), 'EASYCUT / FROM SOURCE TO SHORT', dark=True)
        self.photo('edit', M, 155, 360, 106, (.5, .58))
        self.rect(M, 233, 360, 28, INK, .88)
        self.text(['원본 선택 → 초안 제작 → 직접 검수', 'SOURCE → DRAFT → HUMAN REVIEW', '素材を選ぶ → 下書き → 自分で確認'][self.i], M + 12, 240, 337, 8.5, '#ffffff', True, maxh=14)
        top = 278
        for n, item in enumerate(strategy['workflow']):
            self.rect(M, top + 2, 26, 26, self.accent)
            self.latin(str(n + 1), M + 9, top + 5, 13)
            label = re.sub(r'^\d+\s*[·.\-]\s*', '', item['title'])
            bottom = self.text(label, M + 39, top, 320, 11, '#ffffff', True, maxh=33, minsize=10)
            bottom = self.text(item['body'], M + 39, bottom + 5, 320, 9.5, '#d1d6dc', maxh=59, minsize=9)
            top = bottom + 15
        note = ['계정과 제작 화면에 따라 입력 방식·기능이 달라질 수 있어요. 자동 업로드나 예약 게시 지원 여부는 화면에서 확인하세요.', 'Inputs and features may vary by account and screen. Check support for uploading or scheduling instead of assuming it is automatic.', '入力方法や機能はアカウントと画面で異なる場合があります。自動アップロードや予約投稿の対応は画面で確認しましょう。'][self.i]
        self.text(note, M, max(top, 517), 360, 8, '#a8b1bb', maxh=37, minsize=7.5)

    def storyboard(self, strategy):
        self.new(self.t('sample'), 'STORYBOARD / A WORKING DRAFT')
        self.text(self.t('note'), M, 140, 360, 8.5, MUTED, maxh=38, minsize=8)
        script = strategy['scripts'][0]
        for n, key in enumerate(['open', 'scene', 'close']):
            x = M + n * 123
            photo = [self.v['photo'], 'gear', self.v['photo']][n]
            self.photo(photo, x, 194, 114, 153, (.30 + n * .20, .5))
            self.rect(x, 317, 114, 30, INK, .91)
            self.text(self.t(key), x + 9, 325, 96, 8, '#ffffff', True, maxh=14)
            self.latin(f'0{n + 1}', x + 8, 201, 11, '#ffffff')
        top = 365
        for key, value in [('open', script['hook']), ('scene', script['body'] + ' ' + script['shot']), ('close', script['ending'])]:
            self.text(self.t(key), M, top + 1, 75, 8, MUTED, True, maxh=26)
            bottom = self.text(value, M + 87, top, 273, 10, maxh=76, minsize=9.5)
            top = bottom + 12
            self.line(M, top - 5, W - M)
        self.text(['촬영 메모: 원본 위치 / 시작과 끝 / 확인할 표현', 'SHOT NOTES: source / in & out points / words to verify', '撮影メモ：素材の場所／開始と終了／確かめる表現'][self.i], M, max(531, top), 360, 8, MUTED, maxh=17)
        self.line(M, 553, W - M)

    def worksheet(self):
        self.new(self.t('sheet'), 'WORKSHEET / MAKE IT YOURS')
        self.text(['읽은 내용을 내 영상으로 바꾸는 한 장. 저장하거나 출력해, 한 편을 만들 때마다 채워보세요.', 'Turn the ideas into your own video. Save or print this page and fill it in as you make each Short.', '読んだことを自分の動画にする1枚。保存や印刷をして、1本作るたびに書いてみましょう。'][self.i], M, 138, 360, 9.5, MUTED, maxh=44)
        prompts = [
            ['누구의 어떤 질문에 답할까요?', 'Whose question will you answer?', '誰のどんな疑問に答える？'],
            ['직접 보여줄 근거와 원본 위치', 'Your evidence and source footage', '見せる根拠と元動画の場所'],
            ['첫 문장과 마지막 안내', 'Your opening and closing lines', '最初の一言と最後の案内'],
            ['촬영 / 편집 / 검수에 걸린 시간', 'Time: filming / editing / review', '撮影・編集・確認にかかった時間'],
            ['공개 후 질문과 확인한 반응', 'Questions and responses observed', '公開後の質問と確認した反応'],
            ['다음에 바꿀 한 가지와 확인 날짜', 'One change and a review date', '次に変えることと確認する日'],
        ]
        for n, prompt in enumerate(prompts):
            top = 202 + n * 58
            self.rect(M, top, 23, 23, self.accent if n % 2 == 0 else '#e7e6e0')
            self.latin(str(n + 1), M + 8, top + 5, 9)
            self.text(prompt[self.i], M + 35, top + 2, 322, 10, bold=True, maxh=19)
            self.line(M + 35, top + 40, W - M)

    def faq(self, strategy):
        self.new(self.t('faq'), 'FIELD QUESTIONS / REAL NEXT STEPS')
        top = 166
        for n, item in enumerate(strategy['faqs'][:4]):
            self.latin(f'Q{n + 1}', M, top + 2, 11)
            bottom = self.text(item['q'], M + 35, top, 325, 11, bold=True, maxh=36, minsize=10.5)
            bottom = self.text(item['a'], M + 35, bottom + 8, 325, 9.75, MUTED, maxh=77, minsize=9.25)
            self.line(M, bottom + 13, W - M)
            top = bottom + 29

    def sources(self):
        self.new(self.t('sources'), 'REFERENCES / KEEP THIS CURRENT')
        self.text(['신청 조건과 표시 의무는 달라질 수 있어요. 실행하기 전에 내 국가와 서비스에 맞는 공식 안내를 확인하세요.', 'Requirements and disclosures can change. Check the official guidance for your country and service before taking action.', '条件や表示の義務は変わることがあります。始める前に、自分の国とサービスの公式案内を確かめましょう。'][self.i], M, 137, 360, 9.5, MUTED, maxh=46)
        refs = [(['YouTube 파트너 프로그램', 'YouTube Partner Program', 'YouTube パートナー プログラム'][self.i], 'https://support.google.com/youtube/answer/72851'), (['채널 수익 창출 정책', 'Channel monetization policies', 'チャンネル収益化ポリシー'][self.i], 'https://support.google.com/youtube/answer/1311392'), (['시청자에게 링크 공유', 'Sharing links with viewers', '視聴者とのリンク共有'][self.i], 'https://support.google.com/youtube/answer/13748639'), (['유료 프로모션 표시', 'Paid promotion disclosures', '有料プロモーションの表示'][self.i], 'https://support.google.com/youtube/answer/154235')]
        if self.slug == 'affiliate' and self.locale == 'ko':
            refs.append(('쿠팡 파트너스 공식 안내', 'https://partners.coupang.com/'))
        top = 198
        for n, (name, url) in enumerate(refs):
            self.text(f'{n + 1:02d}  {name}', M, top, 350, 9, bold=True, maxh=17)
            self.text(url, M + 20, top + 17, 340, 6.7, MUTED, maxh=11)
            self.c.linkURL(url + ('?hl=' + self.locale if 'google.com' in url else ''), (M, H - top - 31, W - M, H - top), relative=0)
            top += 36
        top = max(top + 12, 385)
        self.latin('PHOTOGRAPHY / PEXELS', M, top, 7, MUTED)
        top += 15
        for key in sorted(self.used_photos):
            _, name, number = PHOTOS[key]
            label = f'{name} / pexels.com/photo/{number}/'
            self.latin(label, M, top, 6.5, MUTED, False)
            self.c.linkURL('https://www.pexels.com/photo/' + number + '/', (M, H - top - 10, W - M, H - top), relative=0)
            top += 11
        self.rect(M, 464, 360, 68, INK)
        self.text(['오늘은 과제 하나만, 이지컷으로 시작해보세요.', 'Choose one task. Make a draft with EasyCut.', '今日は課題を一つだけ。EasyCutで始めよう。'][self.i], M + 13, 476, 334, 11, '#ffffff', True, maxh=35, minsize=10)
        prefix = {'ko': '', 'en': '/en', 'ja': '/jp'}[self.locale]
        url = 'https://www.easycut.co.kr' + prefix + '/shorts-monetization'
        self.latin('easycut.co.kr' + prefix + '/shorts-monetization', M + 13, 516, 7, self.accent, False)
        self.c.linkURL(url, (M, H - 532, W - M, H - 464), relative=0)
        self.text(self.t('review') + '\n' + self.t('rights'), M, 539, 360, 6.5, MUTED, maxh=22)

    def finish(self):
        assert self.page == 13
        self.c.save()
        reader = PdfReader(self.out)
        assert len(reader.pages) == 13
        assert all(len(page.extract_text()) > 70 for page in reader.pages)
        assert all(page.images for page in [reader.pages[0], reader.pages[2], reader.pages[7], reader.pages[8]])
        for folder in [ROOT / f'web/private/shorts-guides/{self.locale}', ROOT / f'output/pdf/shorts-guides/{self.locale}']:
            folder.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.out, folder / self.out.name)
        folder = ROOT / f'web/public/shorts-guide-previews/{self.locale}'
        folder.mkdir(parents=True, exist_ok=True)
        for page, name, width in [(1, 'cover', 840), (3, 'sample', 1260)]:
            subprocess.run(['pdftoppm', '-f', str(page), '-singlefile', '-scale-to-x', str(width), '-scale-to-y', '-1', '-jpeg', '-jpegopt', 'quality=94', str(self.out), str(folder / f'{self.slug}-{name}')], check=True, capture_output=True, env=RENDER_ENV)
        return {'slug': self.slug, 'locale': self.locale, 'pages': 13, 'bytes': self.out.stat().st_size, 'textChars': sum(len(p.extract_text()) for p in reader.pages), 'photoCount': len(self.used_photos), 'edition': 'editorial-20260927', 'textBoxesChecked': len(self.boxes)}


def make_schedule(b, plan):
    b.new(b.t('schedule'), 'YOUR PACE / YOUR PLAN')
    b.text(['매일 한 편보다, 끝낼 수 있는 일정을 먼저 잡아보세요. 제작량을 약속하는 표가 아니라 작업을 나누는 예시예요.', 'Start with a schedule you can finish. These are ways to divide the work, not promises about how many videos you will produce.', '毎日1本より、続けられる予定を先に。下は本数の約束ではなく、作業を分けるための例です。'][b.i], M, 139, 360, 9.5, MUTED, maxh=49)
    for col, key in enumerate(['short', 'weekend']):
        x, width = M + col * 186, 174
        b.rect(x, 205, width, 47, b.accent if col == 0 else INK)
        b.text(plan[key]['label'], x + 12, 217, width - 24, 11, INK if col == 0 else '#ffffff', True, maxh=30, minsize=10)
        for n, (day, title, detail) in enumerate(plan[key]['steps']):
            top = 269 + n * 70
            b.text(day, x, top, width, 7.3, MUTED, True, maxh=13)
            bottom = b.text(title, x, top + 15, width, 9.3, bold=True, maxh=28, minsize=9)
            b.text(detail, x, bottom + 3, width, 8.1, maxh=top + 66 - bottom - 3, minsize=7.7)
            b.line(x, top + 68, x + width)
    b.text(['실제 소요 시간을 재고, 다음 주 일정에 반영해보세요.', 'Time your own work, then adjust next week’s plan.', '実際にかかる時間を測り、来週の予定に反映しよう。'][b.i], M, 551, 360, 7.2, MUTED, maxh=12)


def build(slug, locale):
    b = Book(slug, locale, ['ko', 'en', 'ja'].index(locale))
    plan = DATA['plans'][slug][locale]
    b.cover()
    b.roadmap()
    for chapter in range(5):
        b.chapter(chapter)
    b.workflow(plan['strategy'])
    b.storyboard(plan['strategy'])
    make_schedule(b, plan)
    b.worksheet()
    b.faq(plan['strategy'])
    b.sources()
    report = b.finish()
    print(json.dumps(report), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--slug', choices=list(DATA['catalog']))
    parser.add_argument('--locale', choices=['ko', 'en', 'ja'])
    args = parser.parse_args()
    reports = [build(slug, locale) for slug in ([args.slug] if args.slug else DATA['catalog']) for locale in ([args.locale] if args.locale else ['ko', 'en', 'ja'])]
    if not args.slug and not args.locale:
        (SOURCE / 'pdf-validation.json').write_text(json.dumps(reports, indent=2) + '\n')
