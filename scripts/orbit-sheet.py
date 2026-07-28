import sys, os
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()

def crop(im, pad=16):
    """Trim to the laces: they are saturated or near-black, the grid is neither."""
    g = im.convert('RGB'); px = g.load(); W,H = g.size
    minx,miny,maxx,maxy = W,H,0,0
    for y in range(0,H,2):
        for x in range(0,W,2):
            r,gg,b = px[x,y]
            sat = max(r,gg,b) - min(r,gg,b)
            if sat > 42 or max(r,gg,b) < 105:
                if x<minx: minx=x
                if x>maxx: maxx=x
                if y<miny: miny=y
                if y>maxy: maxy=y
    if maxx<=minx: return im
    # keep it square-ish so tiles do not distort the model
    cx,cy = (minx+maxx)/2, (miny+maxy)/2
    half = max(maxx-minx, maxy-miny)/2 + pad
    return im.crop((max(0,int(cx-half)), max(0,int(cy-half)),
                    min(W,int(cx+half)), min(H,int(cy+half))))

def sheet(key, title, subtitle, tiles, out, tile=(430,430)):
    labels = ['orbit 0°','orbit 90°','orbit 180°','orbit 270°','from the top']
    ims = []
    for t,lab in zip(tiles, labels):
        im = crop(Image.open(t))
        im.thumbnail(tile, Image.LANCZOS)
        canvas = Image.new('RGB', tile, (247,248,250))
        canvas.paste(im, ((tile[0]-im.width)//2, (tile[1]-im.height)//2))
        d = ImageDraw.Draw(canvas)
        d.text((10, tile[1]-24), lab, font=font(15), fill=(90,95,105))
        ims.append(canvas)
    cols, rows = 3, 2
    W = cols*tile[0] + (cols+1)*10
    HEAD = 78
    H = HEAD + rows*tile[1] + (rows+1)*10
    out_im = Image.new('RGB', (W,H), (255,255,255))
    d = ImageDraw.Draw(out_im)
    d.text((14, 16), title, font=font(28), fill=(20,22,28))
    d.text((14, 50), subtitle, font=font(16), fill=(95,100,112))
    for i,im in enumerate(ims):
        r,c = divmod(i, cols)
        out_im.paste(im, (10 + c*(tile[0]+10), HEAD + 10 + r*(tile[1]+10)))
    out_im.save(out)
    print('wrote', out, out_im.size)


if __name__ == '__main__':
    # Lays out whatever orbit-shots.mjs left in ./orbit as one sheet per scene.
    import glob, os, re
    keys = sorted({re.sub(r'-(a|b|c|d|top)\.png$', '', os.path.basename(p))
                   for p in glob.glob('orbit/*.png')})
    for k in keys:
        tiles = [f'orbit/{k}-{v}.png' for v in ('a', 'b', 'c', 'd', 'top')]
        if all(os.path.exists(t) for t in tiles):
            sheet(k, k, '', tiles, f'sheet-{k}.png')
