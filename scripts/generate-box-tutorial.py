"""Generate the captioned one-level box tutorial from the existing sample SVG.
Requires Pillow and ffmpeg. Run from the repository root.
This is an illustrated walkthrough, not a recording of the editor.
"""
from pathlib import Path
import math, re, subprocess, xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFont, ImageChops
W,H,FPS,SECONDS=960,540,15,20
OUT=Path('public/tutorial');OUT.mkdir(parents=True,exist_ok=True)
svg=ET.parse('site/art/box-stitch.svg').getroot();ns={'s':'http://www.w3.org/2000/svg'}
groups=svg.find('.//s:g[@id="weave-box-stitch"]/s:g',ns)
paths=[]
for g in list(groups)[:6]:
 p=list(g)[1];coords=list(map(float,re.findall(r'-?\d+(?:\.\d+)?',p.attrib['d'])))
 paths.append((coords,p.attrib['stroke']))
assert len(paths)==6
BG='#191410';PANEL='#241e18';TEXT='#f3e9d9';MUTED='#baae9f';ACCENT='#ff6540'
def font(size,bold=False):
 name='DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
 try:return ImageFont.truetype(name,size)
 except OSError:return ImageFont.load_default()
def point(x,y):return (int(360+(x-104)*.75),int(103+(y+29)*.61))
def ribbon(image,coords,color,progress=1):
 x1,y1,x2,y2=coords;x2=x1+(x2-x1)*progress;y2=y1+(y2-y1)*progress
 a,b=point(x1,y1),point(x2,y2);d=ImageDraw.Draw(image)
 for width,c in [(45,'#171410'),(37,color)]:
  d.line([a,b],fill=c,width=width)
  for x,y in (a,b):d.ellipse((x-width/2,y-width/2,x+width/2,y+width/2),fill=c)
steps=[('Create','Draw two starting strands.','Use Create to draw one orange and one gold strand.'),('Attach','Add the four connected arms.','Use Attach at each free endpoint to extend the laces.'),('Move','Position the ends.','Use Move to arrange the arms around the centre.'),('Weave','Lock the final crossing.','Select orange 1_2 over gold 2_3 with Weave.'),('Orbit','One box stitch, one level.','Explore the finished stitch in 3D. No extra levels yet.')]
shot=Image.open('site/shots/box-stitch-dark.webp').convert('RGB');shot.thumbnail((480,365))
proc=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'box-stitch-one-level.mp4')],stdin=subprocess.PIPE)
for frame in range(FPS*SECONDS):
 t=frame/FPS;step=min(4,int(t/4));u=(t%4)/4
 im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
 d.rounded_rectangle((12,12,948,528),radius=15,outline='#453a30',width=1)
 d.text((30,26),'Scoubidou3D  /  Box stitch',font=font(18,True),fill=TEXT)
 d.text((691,30),'ILLUSTRATED WALKTHROUGH',font=font(10),fill=MUTED)
 for i,(name,_,__) in enumerate(steps):
  x=30+i*113;active=i==step
  d.rounded_rectangle((x,64,x+103,96),radius=6,fill=ACCENT if active else PANEL)
  d.text((x+15,72),name,font=font(13,True),fill=BG if active else MUTED)
 d.line((230,111,230,438),fill='#453a30')
 d.text((30,118),'LAYERS · LEVEL 1',font=font(11,True),fill=MUTED)
 count=2 if step==0 else min(6,2+int(u*5)+1) if step==1 else 6
 for idx in range(count):
  y=157+idx*37;c=paths[idx][1];d.rounded_rectangle((30,y,210,y+28),radius=5,fill=PANEL)
  d.rounded_rectangle((40,y+10,60,y+17),radius=3,fill=c)
  d.text((76,y+6),['1_1','2_1','1_2','2_2','1_3','2_3'][idx],font=font(12),fill=TEXT)
 if step<4:
  for x in range(260,929,24):
   for y in range(123,424,24):d.point((x,y),fill='#40352b')
  for idx,(coords,color) in enumerate(paths[:count]):
   c=coords.copy();progress=1
   if step==0:progress=max(.01,min(1,u*3-idx*.65))
   if step==1 and idx>=2:progress=max(.01,min(1,u*5-(idx-2)))
   if step==2 and idx==2:c[3]+=30*math.sin(u*math.pi*2)
   ribbon(im,c,color,progress)
  if step==2:
   x,y=point(paths[2][0][2],paths[2][0][3]+30*math.sin(u*math.pi*2));d=ImageDraw.Draw(im);d.ellipse((x-8,y-8,x+8,y+8),fill=ACCENT,outline=TEXT,width=2)
  if step==3 and u>.3:
   overlay=im.copy();ribbon(overlay,*paths[2]);mask=Image.new('L',(W,H));md=ImageDraw.Draw(mask);c=paths[5][0];md.line([point(*c[:2]),point(*c[2:])],fill=255,width=49);im=Image.composite(overlay,im,mask)
 else:im.paste(shot,(350+(480-shot.width)//2,106))
 d=ImageDraw.Draw(im);d.rectangle((24,442,936,510),fill=PANEL)
 d.text((39,453),f'{step+1:02d}  {steps[step][1]}',font=font(18,True),fill=TEXT)
 d.text((39,484),steps[step][2],font=font(13),fill=MUTED)
 d.rounded_rectangle((30,519,30+int(900*(frame+1)/(FPS*SECONDS)),522),radius=1,fill=ACCENT)
 if frame==int(FPS*15):im.save(OUT/'box-stitch-poster.webp',quality=90)
 proc.stdin.write(im.tobytes())
proc.stdin.close();assert proc.wait()==0
# Captions also remain available independently of burned-in text.
vtt='WEBVTT\n\n'
for i,(_,title,desc) in enumerate(steps):vtt+=f'00:{i*4:02d}.000 --> 00:{(i+1)*4:02d}.000\n{title} {desc}\n\n'
(OUT/'box-stitch-en.vtt').write_text(vtt)
print('Generated 20-second tutorial, poster, and captions.')
