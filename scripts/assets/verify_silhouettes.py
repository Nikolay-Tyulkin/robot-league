import sys,json,struct,os
from pathlib import Path
ROOT=Path(__file__).parent;sys.path.insert(0,str(ROOT/'pythonlib'))
import numpy as np
from PIL import Image,ImageDraw

def glbmeshes(path):
    raw=path.read_bytes();size=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+size]);blob=memoryview(raw)[28+size:]
    def arr(i):
        a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];width=3 if a['type']=='VEC3' else 1
        return np.frombuffer(blob,dtype='<f4' if a['componentType']==5126 else '<u4',count=a['count']*width,offset=v['byteOffset']).reshape(-1,width)
    return {m['name']:(arr(m['primitives'][0]['attributes']['POSITION']),arr(m['primitives'][0]['indices']).reshape(-1,3)) for m in g['meshes']}

def stl(path):
    b=path.read_bytes();n=struct.unpack_from('<I',b,80)[0];dtype=np.dtype([('n','<f4',(3,)),('v','<f4',(3,3)),('attr','<u2')])
    v=np.frombuffer(b,dtype=dtype,count=n,offset=84)['v'].reshape(-1,3)
    return v,np.arange(n*3).reshape(-1,3)

directions=[[1,0,0],[0,1,0],[0,0,1],[1,1,1],[1,-1,1],[-1,1,1],[-1,-1,1]]
def projection(d):
    d=np.array(d,float);d/=np.linalg.norm(d);side=np.cross(d,[0,0,1] if abs(d[2])<.9 else [0,1,0]);side/=np.linalg.norm(side);up=np.cross(side,d)
    return np.array([side,up]).T
def raster(v,f,m,lo,scale):
    p=(v@m-lo)*scale+4;im=Image.new('1',(192,192));draw=ImageDraw.Draw(im)
    for t in p[f]:draw.polygon(tuple(t.reshape(-1)),fill=1)
    return np.asarray(im,dtype=bool)

robot=sys.argv[1] if len(sys.argv)>1 else 'watti'
if robot=='watti' and not os.environ.get('WATTI_URDF_DIR'): raise ValueError('Set WATTI_URDF_DIR to the private robot_description directory')
report={};meshdir=Path(os.environ['WATTI_URDF_DIR'])/'meshes/visual' if robot=='watti' else ROOT/'sources'/robot/'assets'
converted=glbmeshes(ROOT/'repaired_output'/robot/'model.glb')
atlas=Image.new('RGB',(192*7,192*len(converted)),(20,20,20))
for row,(name,(cv,cf)) in enumerate(converted.items()):
    ov,of=stl(meshdir/(name+'.stl'));metrics=[]
    for col,d in enumerate(directions):
        m=projection(d);projected=ov@m;lo=projected.min(axis=0);scale=184/max(np.ptp(projected,axis=0))
        a=raster(ov,of,m,lo,scale);b=raster(cv,cf,m,lo,scale);intersection=(a&b).sum();coverage=intersection/max(a.sum(),1);iou=intersection/max((a|b).sum(),1)
        metrics.append({'direction':d,'coverage':float(coverage),'iou':float(iou)})
        rgb=np.zeros((192,192,3),np.uint8);rgb[:]=[20,20,20];rgb[a&b]=[195,205,220];rgb[a&~b]=[255,65,75];rgb[b&~a]=[40,230,120]
        im=Image.fromarray(rgb);ImageDraw.Draw(im).text((5,5),name,fill=(255,255,255));atlas.paste(im,(col*192,row*192))
    report[name]=metrics;print(name,'min coverage',min(m['coverage'] for m in metrics),'min IoU',min(m['iou'] for m in metrics),flush=True)
(ROOT/'repaired_output'/robot/'silhouette_report.json').write_text(json.dumps(report,indent=2))
atlas.save(ROOT/'repaired_output'/robot/'silhouette_comparison.png')
