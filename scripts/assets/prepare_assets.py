from __future__ import annotations
import sys, os, json, math, struct, hashlib, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT = Path(__file__).parent
os.environ.setdefault('WATTI_ASSET_MM','1')
sys.path.insert(0, str(ROOT / 'pythonlib'))
import numpy as np
import fast_simplification
def watti_directory():
    value = os.environ.get('WATTI_URDF_DIR')
    if not value: raise ValueError('Set WATTI_URDF_DIR to the private robot_description directory containing meshes/visual')
    return Path(value)

SKIP = {'microduck':set(),'reachy':set()}
HOME={'left_hip_roll':-.0873,'right_hip_roll':.0873,'left_hip_pitch':-.4579,'right_hip_pitch':.4579,'left_knee':-.0049,'right_knee':.0049,'left_ankle':.4530,'right_ankle':-.4530,'neck_pitch':.3491,'head_pitch':.3491}

def nums(s, default): return [float(x) for x in s.split()] if s else list(default)
def mulq(a,b):
    x,y,z,w=a; X,Y,Z,W=b
    return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]
def axisq(axis,angle):
    axis=np.array(axis,dtype=float); axis/=max(np.linalg.norm(axis),1e-20)
    return (axis*math.sin(angle/2)).tolist()+[math.cos(angle/2)]
def rpyq(rpy):
    return mulq(axisq([0,0,1],rpy[2]),mulq(axisq([0,1,0],rpy[1]),axisq([1,0,0],rpy[0])))
def matrix(p,q):
    x,y,z,w=q; m=np.eye(4)
    m[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    m[:3,3]=p; return m

def download_selected():
    for name in CONFIG:
        folder=ROOT/'sources'/name
        rows=json.loads((folder/'inventory.json').read_text())
        def one(row):
            if row['file'] in SKIP[name]: return
            target=folder/'assets'/row['file']; target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists(): target.write_bytes(get(row['url']))
            if target.stat().st_size != row['bytes']: raise ValueError(f'Incomplete mesh {target}')
            if not row.get('sha256'): raise ValueError('Inventory has no verified source hash; rerun inventory with the pinned source audit')
            if hashlib.sha256(target.read_bytes()).hexdigest()!=row['sha256']: raise ValueError(f'Source hash mismatch: {target.name}')
        with ThreadPoolExecutor(max_workers=6) as ex: list(ex.map(one,rows))
        print(name,'downloaded',sum(r['bytes'] for r in rows if r['file'] not in SKIP[name]),flush=True)

def simplify(path, name):
    b=path.read_bytes(); count=struct.unpack_from('<I',b,80)[0]
    assert len(b)==84+count*50, f'Not binary STL: {path}'
    dtype=np.dtype([('n','<f4',(3,)),('v','<f4',(3,3)),('attr','<u2')])
    values=np.frombuffer(b, dtype=dtype,count=count,offset=84)['v'].reshape(-1,3)
    v,inv=np.unique(values if os.environ.get('WATTI_ASSET_MM') else np.round(values,7),axis=0,return_inverse=True); f=inv.reshape(-1,3)
    ok=(f[:,0]!=f[:,1])&(f[:,0]!=f[:,2])&(f[:,1]!=f[:,2]); f=f[ok]
    if name=='watti': cap={'head_link':10000,'base_link':8000,'base_rotator_link':3500,'upper_arm_link':5000,'lower_arm_link':4500,'neck_link':3500}.get(path.stem,4000)
    elif name=='microduck': cap=500 if path.stem=='xl330' else 1800
    else: cap=350 if path.stem.startswith(('dc15','stewart_link_ball')) else 1400
    target=min(len(f),cap)
    if len(f)>target and not os.environ.get('WATTI_ASSET_RAW'):
        if os.environ.get('WATTI_ASSET_MM'):
            original_v=v.astype(np.float64); original_f=f.astype(np.int32)
            def area(p,t):return np.linalg.norm(np.cross(p[t[:,1]]-p[t[:,0]],p[t[:,2]]-p[t[:,0]]),axis=1).sum()/2
            original_area=area(original_v,original_f);lo=original_v.min(axis=0);hi=original_v.max(axis=0);tolerance=max(np.max(hi-lo)*.008,1e-5)
            while True:
                candidate_v,candidate_f=fast_simplification.simplify(original_v*1000,original_f,target_count=target,agg=5.,preserve_border=True)
                candidate_v=candidate_v/1000
                area_ratio=area(candidate_v,candidate_f)/max(original_area,1e-20)
                bound_error=max(np.max(np.abs(candidate_v.min(axis=0)-lo)),np.max(np.abs(candidate_v.max(axis=0)-hi)))
                if .975<=area_ratio<=1.025 and bound_error<=tolerance:
                    v,f=candidate_v,candidate_f;break
                if target>=len(original_f)*.8:
                    v,f=original_v,original_f;break
                target=min(len(original_f),target*2)
            print('surface guard',path.name,'retained',round(area(v,f)/max(original_area,1e-20),5),'target',target,flush=True)
        else:
            v,f=fast_simplification.simplify(v.astype(np.float64),f.astype(np.int32),target_count=target,agg=7.)
    v=np.asarray(v,dtype='<f4'); f=np.asarray(f,dtype='<u4')
    normals=np.zeros(v.shape,dtype=np.float32)
    cross=np.cross(v[f[:,1]]-v[f[:,0]],v[f[:,2]]-v[f[:,0]])
    for j in range(3): np.add.at(normals,f[:,j],cross)
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-20)
    return v,normals,f, count

class Builder:
    def __init__(self,name):
        self.name=name; self.nodes=[]; self.meshes=[]; self.materials=[]; self.views=[]; self.accessors=[]; self.buffer=bytearray(); self.geo={}; self.meshcache={}; self.matcache={}; self.nodegeo={}; self.joints={}; self.bodies={}; self.total_triangles=0
        self.add_node('ModelRoot',None,[0,0,0],axisq([1,0,0],-math.pi/2))
    def add_node(self,name,parent,p=(0,0,0),q=(0,0,0,1),mesh=None):
        i=len(self.nodes); node={'name':name,'translation':list(p),'rotation':list(q)}
        if mesh is not None: node['mesh']=mesh
        self.nodes.append(node)
        if parent is not None: self.nodes[parent].setdefault('children',[]).append(i)
        return i
    def arr(self,a,ctype,typ,target):
        while len(self.buffer)%4:self.buffer.append(0)
        offset=len(self.buffer); self.buffer.extend(a.tobytes()); bv=len(self.views)
        self.views.append({'buffer':0,'byteOffset':offset,'byteLength':a.nbytes,'target':target})
        acc={'bufferView':bv,'componentType':ctype,'count':len(a),'type':typ}
        if typ=='VEC3': acc.update(min=a.min(axis=0).astype(float).tolist(),max=a.max(axis=0).astype(float).tolist())
        self.accessors.append(acc);return len(self.accessors)-1
    def geo_mesh(self,path,color):
        key=str(path)
        if key not in self.geo:
            v,n,f,original=simplify(path,self.name)
            ai=self.arr(v,5126,'VEC3',34962); an=self.arr(n,5126,'VEC3',34962); af=self.arr(f.reshape(-1),5125,'SCALAR',34963)
            self.geo[key]=(v,{'attributes':{'POSITION':ai,'NORMAL':an},'indices':af},len(f))
            print(self.name,path.name,original,'->',len(f),flush=True)
        col=tuple(round(float(c),6) for c in color)
        if col not in self.matcache:
            mat={'name':f'material_{len(self.materials)}','pbrMetallicRoughness':{'baseColorFactor':list(col),'metallicFactor':.24 if self.name=='watti' else .08,'roughnessFactor':.4 if self.name=='watti' else .46},'doubleSided':True}
            if col[3]<1: mat.update(alphaMode='BLEND',doubleSided=True)
            self.matcache[col]=len(self.materials);self.materials.append(mat)
        mi=self.matcache[col]; cachekey=(key,mi)
        if cachekey not in self.meshcache:
            prim=dict(self.geo[key][1]);prim['material']=mi
            self.meshcache[cachekey]=len(self.meshes);self.meshes.append({'name':path.stem,'primitives':[prim]})
        return self.meshcache[cachekey],self.geo[key][0],self.geo[key][2]
    def visual(self,parent,path,p,q,color,scale=(1,1,1)):
        mesh,v,tri=self.geo_mesh(path,color)
        i=self.add_node(f'visual_{parent}_{path.stem}_{len(self.nodes)}',parent,p,q,mesh)
        if tuple(scale)!=(1,1,1): self.nodes[i]['scale']=list(scale)
        self.nodegeo[i]=v;self.total_triangles+=tri
    def finish(self,source):
        worlds={}
        def walk(i,prev):
            n=self.nodes[i]; local=matrix(n.get('translation',[0]*3),n.get('rotation',[0,0,0,1]));local[:3,:3]*=n.get('scale',[1]*3)
            world=prev@local;worlds[i]=world
            for j in n.get('children',[]):walk(j,world)
        walk(0,np.eye(4))
        pts=[]
        for i,v in self.nodegeo.items(): pts.append(v@worlds[i][:3,:3].T+worlds[i][:3,3])
        points=np.concatenate(pts); lower=points.min(axis=0);upper=points.max(axis=0)
        self.nodes[0]['translation'][1]=-float(lower[1]); upper[1]-=lower[1];lower[1]=0
        doc={'asset':{'version':'2.0','generator':'Robot League CAD asset converter'},'scene':0,'scenes':[{'name':self.name,'nodes':[0]}],'nodes':self.nodes,'meshes':self.meshes,'materials':self.materials,'buffers':[{'byteLength':len(self.buffer)}],'bufferViews':self.views,'accessors':self.accessors}
        jb=json.dumps(doc,separators=(',',':')).encode();jb+=b' '*((-len(jb))%4); bb=bytes(self.buffer);bb+=b'\0'*((-len(bb))%4)
        glb=struct.pack('<III',0x46546c67,2,12+8+len(jb)+8+len(bb))+struct.pack('<II',len(jb),0x4e4f534a)+jb+struct.pack('<II',len(bb),0x004e4942)+bb
        out=ROOT/('raw_output' if os.environ.get('WATTI_ASSET_RAW') else 'repaired_output' if os.environ.get('WATTI_ASSET_MM') else 'output')/self.name;out.mkdir(parents=True,exist_ok=True)
        (out/'model.glb').write_bytes(glb)
        manifest={'id':self.name,'model':'model.glb','units':'meters','upAxis':'Y','sourceUpAxis':'Z','quaternionOrder':'xyzw','jointRotationRule':'Set quaternion = restQuaternion * axisAngle(axis, angle - restAngle). Joint angles use source radians. Ball joints use quaternion rotation. ModelRoot converts source Z-up to Y-up and grounds feet.','bounds':{'min':lower.tolist(),'max':upper.tolist(),'size':(upper-lower).tolist()},'triangles':self.total_triangles,'joints':self.joints,'bodies':self.bodies,'source':source}
        (out/'rig.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
        legal=ROOT.parents[1]/'public/models'/self.name
        for filename in ['LICENSE','NOTICE.md']:
            if (legal/filename).exists(): (out/filename).write_bytes((legal/filename).read_bytes())
        print('FINISHED',self.name,'GLB',len(glb),'triangles',self.total_triangles,'bounds',manifest['bounds'],flush=True)

def build_mjcf(name):
    cfg=CONFIG[name];folder=ROOT/'sources'/name;xml=ET.parse(folder/cfg['file']).getroot();builder=Builder(name)
    meshes={(m.get('name') or Path(m.get('file')).stem):m.get('file') for m in xml.findall('./asset/mesh')}
    mats={m.get('name'):nums(m.get('rgba'),[.8,.8,.8,1]) for m in xml.findall('./asset/material')}
    def visit(body,parent):
        nm=body.get('name') or ('anonymous_'+str(len(builder.nodes)));p=nums(body.get('pos'),[0]*3);mq=nums(body.get('quat'),[1,0,0,0]);q=mq[1:]+mq[:1]
        ni=builder.add_node('body_'+nm,parent,p,q);gi=ni
        builder.bodies[nm]={'node':'body_'+nm,'parentNode':builder.nodes[parent]['name'],'position':p,'quaternion':q}
        for joint in body.findall('./joint'):
            jn=joint.get('name');axis=nums(joint.get('axis'),[0,0,1]);jp=nums(joint.get('pos'),[0]*3);rest=HOME.get(jn,0.) if name=='microduck' else 0.;jq=axisq(axis,rest)
            ji=builder.add_node('joint_'+jn,gi,jp,jq);gi=builder.add_node('pivot_content_'+jn,ji,[-x for x in jp])
            builder.joints[jn]={'node':'joint_'+jn,'body':nm,'type':joint.get('type','hinge'),'axis':axis,'range':nums(joint.get('range'),[-math.pi,math.pi]),'restAngle':rest,'restQuaternion':jq}
        for geom in body.findall('./geom'):
            if geom.get('class')!='visual' or not geom.get('mesh'):continue
            file=meshes[geom.get('mesh')]
            if file in SKIP[name]:continue
            mq=nums(geom.get('quat'),[1,0,0,0]);q=mq[1:]+mq[:1]
            builder.visual(gi,folder/'assets'/file,nums(geom.get('pos'),[0]*3),q,mats.get(geom.get('material'),nums(geom.get('rgba'),[.8,.8,.8,1])))
        for child in body.findall('./body'):visit(child,gi)
    for body in xml.findall('./worldbody/body'):visit(body,0)
    builder.finish({'type':'official-mjcf','url':f"https://github.com/{cfg['repo']}/blob/{cfg['branch']}/{cfg['path']}/{cfg['file']}",'license':'LicenseRef-Pollen-BY-NC-SA-Unversioned','softwareLicense':'Apache-2.0','commit':cfg['branch'],'licenseStatement':f"https://github.com/{cfg['repo']}/blob/{cfg['branch']}/README.md#license",'omittedInternalMeshes':sorted(SKIP[name]),'notes':'Visual geometry simplified, colors and all body/joint origins preserved. Reachy Stewart closed-loop constraints require a separate IK controller or authored head/rod animation.'})
    (ROOT/('raw_output' if os.environ.get('WATTI_ASSET_RAW') else 'repaired_output' if os.environ.get('WATTI_ASSET_MM') else 'output')/name/'LICENSE').write_bytes((folder/'LICENSE').read_bytes())

def build_watti():
    snapshot=Path(os.environ.get('WATTI_FUSION_SNAPSHOT',str(ROOT/'sources/watti/Watti_fusion_snapshot.json')))
    if snapshot.exists():
        build_watti_snapshot(snapshot)
        return
    if not os.environ.get('WATTI_ALLOW_LEGACY_URDF'):
        raise FileNotFoundError(f'Current Fusion snapshot is required; set WATTI_FUSION_SNAPSHOT: {snapshot}')
    folder=watti_directory();xml=ET.parse(folder/'urdf/lamp_robot.urdf').getroot();builder=Builder('watti')
    mats={m.get('name'):nums(m.find('color').get('rgba'),[.55,.42,.25,1]) for m in xml.findall('./material')}
    joints={j.find('child').get('link'):j for j in xml.findall('./joint')};links={l.get('name'):l for l in xml.findall('./link')}
    byparent={}
    for j in joints.values():byparent.setdefault(j.find('parent').get('link'),[]).append(j.find('child').get('link'))
    def origin(e):
        if e is None:return [0]*3,[0,0,0,1]
        return nums(e.get('xyz'),[0]*3),rpyq(nums(e.get('rpy'),[0]*3))
    def visit(nm,parent):
        j=joints.get(nm);p,q=origin(j.find('origin') if j is not None else None)
        ni=builder.add_node('body_'+nm,parent,p,q);gi=ni
        builder.bodies[nm]={'node':'body_'+nm,'parentNode':builder.nodes[parent]['name'],'position':p,'quaternion':q}
        if j is not None and j.get('type')!='fixed':
            axis=nums(j.find('axis').get('xyz'),[1,0,0]);jn=j.get('name');lim=j.find('limit')
            gi=builder.add_node('joint_'+jn,ni)
            builder.joints[jn]={'node':'joint_'+jn,'body':nm,'type':j.get('type'),'axis':axis,'range':[float(lim.get('lower')),float(lim.get('upper'))],'restAngle':0,'restQuaternion':[0,0,0,1]}
        for v in links[nm].findall('./visual'):
            mesh=v.find('./geometry/mesh');file=mesh.get('filename').replace('package://robot_description/','');vp,vq=origin(v.find('origin'));mat=v.find('material');color=mats.get(mat.get('name'),[.55,.42,.25,1])
            builder.visual(gi,folder/file,vp,vq,color,nums(mesh.get('scale'),[1]*3))
        for child in byparent.get(nm,[]):visit(child,gi)
    for nm in links:
        if nm not in joints:visit(nm,0)
    builder.finish({'type':'user-provided-urdf','path':'lamp_robot.urdf','license':'CC-BY-NC-4.0','notes':'All six visual meshes included and simplified; all five active joint axes and limits preserved.'})

def build_watti_snapshot(snapshot):
    folder=watti_directory()
    data=json.loads(snapshot.read_text(encoding='utf-8-sig'));builder=Builder('watti')
    joints={j['name']:j for j in data['joints'] if j.get('important')}
    chain=[('base_link',None),('base_rotator_link','base_yaw'),('lower_arm_link','shoulder_pitch'),('upper_arm_link','elbow_pitch'),('neck_link','neck_pitch'),('head_link','head_yaw')]
    parent=0;previous_pivot=np.zeros(3)
    for link,joint_name in chain:
        joint=joints.get(joint_name);pivot=np.array(joint['joint_frame_in_root']['xyz_m']) if joint else np.zeros(3)
        node=builder.add_node('body_'+link,parent,(pivot-previous_pivot).tolist())
        builder.bodies[link]={'node':'body_'+link,'parentNode':builder.nodes[parent]['name'],'position':(pivot-previous_pivot).tolist(),'quaternion':[0,0,0,1]}
        content=node
        if joint:
            content=builder.add_node('joint_'+joint_name,node)
            lim=joint['limits']
            builder.joints[joint_name]={'node':'joint_'+joint_name,'body':link,'type':'revolute','axis':joint['axis_in_root'],'range':[lim['minimum_rad'],lim['maximum_rad']],'restAngle':0,'restQuaternion':[0,0,0,1],'pivotInSourceRoot':pivot.tolist()}
        frame=data['links'][link]['component_frame_in_root']
        visual_pos=(np.array(frame['xyz_m'])-pivot).tolist();visual_quat=rpyq(frame['rpy_rad'])
        builder.visual(content,folder/'meshes/visual'/f'{link}.stl',visual_pos,visual_quat,[.55,.42,.25,1])
        parent=content;previous_pivot=pivot
    builder.finish({'type':'user-provided-fusion-snapshot','path':snapshot.name,'sha256':__import__('hashlib').sha256(snapshot.read_bytes()).hexdigest(),'generatedAt':data.get('generated_at_utc'),'license':'CC-BY-NC-4.0','notes':'All six component-local STL visuals transformed using current Fusion component_frame_in_root. Joint origins and axes use important snapshot joints in root-aligned local pivot frames. Snapshot current position_rad=0 is preserved; spring rest_rad is not applied. The older URDF does not match these STL rest frames and is intentionally superseded.'})

def get(url):
    req=urllib.request.Request(url, headers={'User-Agent':'WattiFootball-AssetBuilder'})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read()

CONFIG = {
 'microduck': {'repo':'pollen-robotics/microduck_rl', 'branch':'29e887ecfbf5d37144759e5a9f8a176dfb83d547', 'path':'src/mjlab_microduck/robot/microduck', 'file':'robot_walk.xml'},
 'reachy': {'repo':'pollen-robotics/reachy_mini','branch':'234a978e4426895fc88d864e7f154643aea77f53','path':'src/reachy_mini/descriptions/reachy_mini/mjcf','file':'reachy_mini.xml'}
}

def inventory():
    for name,cfg in CONFIG.items():
        folder=ROOT/'sources'/name; folder.mkdir(parents=True,exist_ok=True)
        base=f"https://raw.githubusercontent.com/{cfg['repo']}/{cfg['branch']}/"
        xmlbytes=get(base+cfg['path']+'/'+cfg['file'])
        (folder/cfg['file']).write_bytes(xmlbytes)
        (folder/'LICENSE').write_bytes(get(base+'LICENSE'))
        xml=ET.fromstring(xmlbytes)
        used={g.get('mesh') for g in xml.findall('.//worldbody//geom') if g.get('class')=='visual'}
        files=[m.get('file') for m in xml.findall('./asset/mesh') if (m.get('name') or Path(m.get('file')).stem) in used]
        rows=[]
        if name=='microduck':
            tree=json.loads(get(f"https://api.github.com/repos/{cfg['repo']}/git/trees/{cfg['branch']}?recursive=1"))
            size={e['path']:e.get('size',0) for e in tree['tree']}
            for f in files: rows.append({'file':f,'bytes':size[cfg['path']+'/assets/'+f], 'url':base+cfg['path']+'/assets/'+f})
        else:
            def lfs(f):
                pointer=get(base+cfg['path']+'/assets/'+f).decode()
                return {'file':f,'bytes':int(pointer.split('size ')[1]),'url':f"https://media.githubusercontent.com/media/{cfg['repo']}/{cfg['branch']}/{cfg['path']}/assets/{f}"}
            with ThreadPoolExecutor(max_workers=6) as ex: rows=list(ex.map(lfs,files))
        audit=json.loads((ROOT.parents[1]/'docs/asset-provenance.json').read_text(encoding='utf-8'))['models'][name]
        if audit['commit']!=cfg['branch']: raise ValueError('Source revision changed: audit its license and hashes before regeneration')
        hashes={item['sourcePath']:item['sha256'] for item in audit['files']}
        for filename in [cfg['file'],'LICENSE']:
            if hashlib.sha256((folder/filename).read_bytes()).hexdigest()!=hashes[filename]: raise ValueError(f'Source hash mismatch: {filename}')
        for row in rows: row['sha256']=hashes['assets/'+row['file']]
        (folder/'inventory.json').write_text(json.dumps(rows,indent=2))
        print(name,'total',sum(r['bytes'] for r in rows),'files',len(rows),flush=True)
        for r in sorted(rows,key=lambda r:-r['bytes']): print(r['file'],r['bytes'],flush=True)

if __name__=='__main__':
    action=sys.argv[1] if len(sys.argv)>1 else 'inventory'
    if action=='inventory':inventory()
    elif action=='download':download_selected()
    elif action=='build':
        for name in CONFIG:build_mjcf(name)
        build_watti()
    elif action=='watti':build_watti()
    elif action in CONFIG:build_mjcf(action)
