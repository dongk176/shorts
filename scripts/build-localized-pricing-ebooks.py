"""Rebuild the complete English/Japanese pricing collection from reviewed page JSON.

Full books stay private; only pages 1-3 and a deliberately unreadable lock image
are published. No application, customer, database or worker credentials needed.
"""
from pathlib import Path
import argparse, html, json, os, re, subprocess
from io import BytesIO
from urllib.parse import urlparse
from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'docs/ebooks/localized'
TMP=ROOT/'tmp/pricing-ebooks'; TMP.mkdir(parents=True,exist_ok=True)
W,H,M=420,594,32
COLORS=['#bca1f4','#87bfe5','#e7a78c','#9dd0b2','#e6ba69','#b5c6ec','#e5a7c4']
TITLES={
'monetization-7': ('7 Ways to Monetize Short Videos','ショート動画で収益を生む7つの方法'),
'multi-platform': ('YouTube Shorts, Reels & TikTok: A Practical Playbook','YouTube・リール・TikTokを同時に育てる実践ガイド'),
'copyright-survival': ('The Short-Video Copyright Guide','ショート動画の著作権ガイド'),
'monetization-playbook': ('The Practical Short-Video Monetization Guide','ショート動画収益化の実践ガイド'),
'viral-formula': ('Build Shorts People Want to Watch','見たくなるショート動画の作り方'),
'low-views-diagnosis': ('Why Your Shorts Aren’t Getting Views','再生数が伸びないショート動画の診断書'),
 'title-300': ('300 Short-Video Title Templates','ショート動画のタイトル例300選'),
}
fonts=TMP/'fonts'; fonts.mkdir(exist_ok=True)
for weight,suffix in [(400,''),(600,'-bold')]:
 target=fonts/f'ja{suffix}.ttf'
 if not target.exists():
  from fontTools.ttLib import TTFont as VariableFont
  from fontTools.varLib.instancer import instantiateVariableFont
  font=VariableFont(ROOT/'web/public/fonts/editor/NotoSansCJKjp-Variable.ttf')
  instantiateVariableFont(font,{'wght':weight},inplace=True).save(target)
 pdfmetrics.registerFont(TTFont('ja'+suffix,str(target)))
# All English glyphs used below are supported by the embedded Noto face as well.
pdfmetrics.registerFontFamily('ja',normal='ja',bold='ja-bold',italic='ja',boldItalic='ja-bold')
fontconfig=TMP/'fonts.conf'
fontconfig.write_text(f'<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>{fonts}</dir><cachedir>{TMP}/fontconfig-cache</cachedir></fontconfig>')
ENV={**os.environ,'FONTCONFIG_FILE':str(fontconfig)}


def para(text,width,size=11,bold=False,color='#20232a',locale='en',leading=None):
 text=text.replace('\x00','').replace('–','-').replace('—','-').replace('‑','-')
 return Paragraph(html.escape(text).replace('\n','<br/>'),ParagraphStyle('body',fontName='ja-bold' if bold else 'ja',fontSize=size,leading=leading or size*1.4,textColor=HexColor(color),wordWrap='CJK' if locale=='ja' else None,splitLongWords=True,spaceAfter=0))

def text(c,value,x,top,width,size=11,bold=False,color='#20232a',maxh=1000,locale='en',minimum=9):
 while True:
  p=para(value,width,size,bold,color,locale); _,height=p.wrap(width,2000)
  if height<=maxh+.1: break
  size-=.25
  if size<minimum: raise ValueError(('text overflow',value[:90],height,maxh))
 assert top+height<=H-10,(value[:40],top,height)
 p.drawOn(c,x,H-top-height)
 return height,size

def photo(c,reader,x,top,width,height):
 iw,ih=reader.getSize(); scale=max(width/iw,height/ih);dw,dh=iw*scale,ih*scale
 c.saveState();p=c.beginPath();p.rect(x,H-top-height,width,height);c.clipPath(p,stroke=0)
 c.drawImage(reader,x-(dw-width)*.5,H-top-height-(dh-height),dw,dh);c.restoreState()

def rect(c,x,top,width,height,color):
 c.setFillColor(HexColor(color));c.rect(x,H-top-height,width,height,fill=1,stroke=0)

def references(c,body,locale,accent):
 pairs=[];seen=set();previous=''
 pattern=r'https?://[^\s]+|(?:support\.google\.com|facebook\.com|help\.instagram\.com|support\.tiktok\.com|creativecommons\.org|copyright\.gov|ftc\.gov|affiliate-program\.amazon\.com|blog\.youtube)[^\s]*'
 for line in body.splitlines():
  found=re.search(pattern,line)
  if found:
   raw=found.group().rstrip('.,;）)');url=raw if raw.startswith('http') else 'https://'+raw
   if url in seen:continue
   seen.add(url)
   label=line[:found.start()].strip(' -:・') or previous
   pairs.append((label,url))
  if line.strip():previous=line.strip()
 assert pairs
 intro='リンク名を押すと公式資料を開けます。条件は申請・投稿時に再確認してください。' if locale=='ja' else 'Open a title to read the official guidance. Recheck current terms before applying or publishing.'
 text(c,intro,M,139,W-2*M,9.5,maxh=40,locale=locale)
 cols=2 if len(pairs)>11 else 1;rows=(len(pairs)+cols-1)//cols
 width=(W-2*M-16*(cols-1))/cols;step=min(43,354/rows)
 for i,(label,url) in enumerate(pairs):
  col,row=divmod(i,rows);x=M+col*(width+16);top=190+row*step
  text(c,label,x,top,width,9,True,maxh=step-13,locale=locale,minimum=8)
  text(c,urlparse(url).netloc.replace('www.',''),x,top+step-12,width,6.5,color='#626a6f',maxh=10,minimum=6.5)
  c.linkURL(url,(x,H-top-step+1,x+width,H-top),relative=0)
 return 9

def build(file):
 data=json.loads(file.read_text());slug,locale=data['slug'],data['locale']; pages=data['pages']; count=len(pages)
 index=list(TITLES).index(slug);accent=COLORS[index]; title=TITLES[slug][locale=='ja']
 dest=ROOT/f'web/private/ebooks/{locale}/{slug}.pdf'; dest.parent.mkdir(parents=True,exist_ok=True)
 c=canvas.Canvas(str(dest),pagesize=(W,H),pageCompression=1)
 c.setTitle(title);c.setAuthor('EasyCut');c.setSubject(('日本向け日本語版' if locale=='ja' else 'English edition with US market examples')+' | 2026-11-01')
 c.setCreator('EasyCut localized pricing collection 2026-11-01')
 with Image.open(SOURCE/'assets'/('japan-creator.png' if locale=='ja' else 'english-creator.png')) as im:
  buf=BytesIO();im.convert('RGB').save(buf,'JPEG',quality=90,optimize=True);buf.seek(0);portrait=ImageReader(buf)
 report=[]
 for n,page in enumerate(pages,1):
  assert page['number']==n
  rect(c,0,0,W,H,'#f5f2eb')
  if n==1:
   photo(c,portrait,0,0,W,355)
   rect(c,0,319,W,275,'#151b20')
   rect(c,M,298,142,30,accent)
   text(c,'日本語版・日本向け' if locale=='ja' else 'ENGLISH / US EDITION',M+9,305,126,8,True,maxh=16,locale=locale,minimum=8)
   text(c,'EASYCUT',M,28,280,15,True,'#ffffff',maxh=26)
   text(c,f'CREATOR PLAYBOOK / {index+1:02d}',M,56,330,7,False,'#ffffff',maxh=13,minimum=7)
   _,size=text(c,title,M,345,W-2*M,26,True,'#ffffff',maxh=122,locale=locale,minimum=21)
   text(c,page['body'],M,480,W-2*M,10.5,False,'#d4d9da',maxh=65,locale=locale,minimum=9)
   text(c,'AI生成のイメージ人物' if locale=='ja' else 'AI-generated illustrative creator',M,551,320,6.5,False,'#b7bfc2',maxh=12,locale=locale,minimum=6.5)
   text(c,f'{count} PAGES  /  2026 EDITION',M,566,310,7,False,accent,maxh=13,minimum=7)
  else:
   text(c,'EASYCUT',M,23,240,9,True,maxh=16,minimum=9)
   text(c,'日本語版・日本向け' if locale=='ja' else 'ENGLISH / US EDITION',250,25,138,6.8,False,maxh=12,locale=locale,minimum=6.8)
   rect(c,M,48,W-2*M,1,'#d3d3ce')
   rect(c,M,67,25,3,accent)
   isrefs=(n==count and slug not in ['title-300','monetization-playbook']) or (slug=='monetization-playbook' and n==19)
   heading=('公式参考資料' if locale=='ja' else 'Official sources') if isrefs else page['title']
   titleheight,_=text(c,heading,M,85,W-2*M,22,True,maxh=85,locale=locale,minimum=18)
   if isrefs:
    size=references(c,page['body'],locale,accent)
    rect(c,M,559,W-2*M,.6,'#d3d3ce')
    text(c,f'{n:02d} / {count:02d}',342,571,50,7,maxh=13,minimum=7)
    text(c,'2026.11.01 改訂' if locale=='ja' else 'REVISED 2026-11-01',M,571,295,6.5,maxh=12,locale=locale,minimum=6.5)
    report.append({'page':n,'smallestBody':size});c.showPage();continue
   start=max(143,85+titleheight+20)
   body=re.sub(r'(?m)^(\d{1,3})[ \t]*\n',r'\1  ',page['body'])
   blocks=[b.strip() for b in body.split('\n\n') if b.strip()]
   bodysize=11 if locale=='en' else 10.5
   available=550-start
   while True:
    heights=[para(b,W-2*M,bodysize,locale=locale).wrap(W-2*M,2000)[1] for b in blocks]
    total=sum(heights)+6*max(0,len(blocks)-1)
    if total<=available: break
    bodysize-=.25
    if bodysize<9: raise ValueError(('body overflow',slug,locale,n,total,available))
   top=start
   for b,height in zip(blocks,heights):
    text(c,b,M,top,W-2*M,bodysize,maxh=height+.1,locale=locale,minimum=bodysize)
    for url in re.findall(r'https?://[^\s<>]+',b):
     c.linkURL(url,(M,H-top-height,W-M,H-top),relative=0)
    top+=height+6
   rect(c,M,559,W-2*M,.6,'#d3d3ce')
   text(c,f'{n:02d} / {count:02d}',342,571,50,7,maxh=13,minimum=7)
   text(c,'2026.11.01 改訂' if locale=='ja' else 'REVISED 2026-11-01',M,571,295,6.5,color='#646b70',maxh=12,locale=locale,minimum=6.5)
   size=bodysize
  # A small colophon on the closing page accurately identifies generated imagery.
  if n==count:
   # Metadata, not a claim of a real creator endorsement.
   c.setSubject(c._doc.info.subject+' | Cover: AI-generated illustrative fictional creator')
  report.append({'page':n,'smallestBody':size})
  c.showPage()
 c.save();reader=PdfReader(dest)
 assert len(reader.pages)==count
 assert all(len(p.extract_text())>35 for p in reader.pages)
 assert not re.search('[가-힣]',''.join(p.extract_text() for p in reader.pages))
 preview=ROOT/f'web/public/ebook-previews/{locale}/{slug}';preview.mkdir(parents=True,exist_ok=True)
 for page in [1,2,3]:
  subprocess.run(['pdftoppm','-f',str(page),'-singlefile','-scale-to-x','1400','-scale-to-y','-1','-jpeg','-jpegopt','quality=92',str(dest),str(preview/f'page-{page:02d}-hq')],check=True,capture_output=True,env=ENV,timeout=60)
 # Never publish a fourth readable page. The lock background is an empty paper card.
 Image.new('RGB',(420,594),'#e4e0d7').save(preview/'page-04.jpg',quality=85)
 result={'slug':slug,'locale':locale,'pages':count,'bytes':dest.stat().st_size,'bodySizeMin':min(p['smallestBody'] for p in report),'textChars':sum(len(p.extract_text()) for p in reader.pages)}
 print(json.dumps(result),flush=True)
 return result

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--slug');parser.add_argument('--locale',choices=['en','ja']);args=parser.parse_args()
 files=[p for p in sorted(SOURCE.glob('*.json')) if (not args.slug or p.name.startswith(args.slug+'.')) and (not args.locale or p.name.endswith('.'+args.locale+'.json'))]
 assert files,'No localized source files'
 result=[];failures=[]
 for file in files:
  try:
   result.append(build(file))
  except (AssertionError,ValueError) as error:
   failures.append((file.name,str(error)));print(str(error),flush=True)
 (TMP/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
 if failures: raise ValueError(failures)
