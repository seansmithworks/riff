import re, base64, io
from PIL import Image
src=open('riff-voice-real.src.html').read()
def uri(m):
    im=Image.open(m.group(1)).convert('RGB'); b=io.BytesIO(); im.save(b,'JPEG',quality=84)
    return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
out=re.sub(r'\{\{img:([^}]+)\}\}', uri, src)
open('riff-voice-real.html','w').write(out); print(len(out))
