"""Generate the app icons (tow-truck + wrench on navy) with Pillow."""
from PIL import Image, ImageDraw
import os
NAVY=(31,42,68,255); AMBER=(245,179,1,255); WHITE=(255,255,255,255)
def art(size, rounded, scale=0.62, transparent=False):
    S=1024
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    if transparent: pass
    elif rounded: d.rounded_rectangle((0,0,S,S),radius=220,fill=NAVY)
    else: d.rectangle((0,0,S,S),fill=NAVY)
    # truck drawn in a 600x420 box, then scaled/centred
    layer=Image.new('RGBA',(600,420),(0,0,0,0)); g=ImageDraw.Draw(layer)
    g.rounded_rectangle((20,200,330,300),radius=14,fill=AMBER)            # flat bed
    g.polygon([(330,200),(330,300),(560,300),(560,250),(510,180),(430,150),(430,200)],fill=AMBER) # cab
    g.polygon([(445,168),(445,205),(505,205),(480,178)],fill=NAVY)         # window
    g.line([(90,200),(250,70)],fill=WHITE,width=16)                        # boom
    g.line([(250,70),(250,125)],fill=WHITE,width=8)                        # cable
    g.ellipse((235,120,265,150),outline=WHITE,width=8)                     # hook
    for cx in (110,430):
        g.ellipse((cx-52,262,cx+52,366),fill=WHITE); g.ellipse((cx-26,288,cx+26,340),fill=NAVY)
    w=int(S*scale); h=int(w*420/600); layer=layer.resize((w,h),Image.LANCZOS)
    im.alpha_composite(layer,((S-w)//2,(S-h)//2+20))
    return im.resize((size,size),Image.LANCZOS)
os.makedirs('www/icons',exist_ok=True)
art(192,True,0.7).save('www/icons/icon-192.png'); art(512,True,0.7).save('www/icons/icon-512.png')
art(512,False,0.5).save('www/icons/icon-maskable-512.png'); art(180,False,0.62).convert('RGB').save('www/icons/apple-touch-icon.png')
art(1024,True,0.7).save('www/icons/icon-1024.png')

# ---- Android launcher icons + splash (only if the Capacitor android/ project exists)
res='android/app/src/main/res'
if os.path.isdir(res):
    dens={'mdpi':1,'hdpi':1.5,'xhdpi':2,'xxhdpi':3,'xxxhdpi':4}
    for k,m in dens.items():
        d=f'{res}/mipmap-{k}'
        art(int(48*m),True,0.7).save(f'{d}/ic_launcher.png')
        # round icon: circle crop of the full-bleed art
        full=art(int(48*m),False,0.6); mask=Image.new('L',full.size,0); ImageDraw.Draw(mask).ellipse((0,0,full.size[0]-1,full.size[1]-1),fill=255)
        rd=Image.new('RGBA',full.size,(0,0,0,0)); rd.paste(full,(0,0),mask); rd.save(f'{d}/ic_launcher_round.png')
        art(int(108*m),False,0.5,transparent=True).save(f'{d}/ic_launcher_foreground.png')
    open(f'{res}/values/ic_launcher_background.xml','w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1F2A44</color>\n</resources>\n')
    for dp in os.listdir(res):
        if dp.startswith('drawable') and os.path.exists(f'{res}/{dp}/splash.png'):
            w,h=Image.open(f'{res}/{dp}/splash.png').size
            im=Image.new('RGBA',(w,h),NAVY); ic=art(int(min(w,h)*0.3),False,0.9,transparent=True); im.alpha_composite(ic,((w-ic.width)//2,(h-ic.height)//2)); im.convert('RGB').save(f'{res}/{dp}/splash.png')
    print('android icons + splash written')
print('ok')
