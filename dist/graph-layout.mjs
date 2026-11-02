// A deterministic spanning forest. Cross-links stay explicit in the selection list.
export function layoutGraph(nodes, edges) {
 const names=new Set(nodes.map(n=>n.path)), children=new Map([...names].map(p=>[p,[]])), incoming=new Set();
 for(const e of edges) if(names.has(e.source)&&names.has(e.target)&&e.source!==e.target){if(!children.get(e.source).includes(e.target)) children.get(e.source).push(e.target);incoming.add(e.target);}
 for(const list of children.values()) list.sort();
 const visited=new Set(), positions=new Map(), branches=new Set(); let row=0,maxDepth=0;
 function visit(path,depth,parent){if(visited.has(path))return;visited.add(path);maxDepth=Math.max(maxDepth,depth);positions.set(path,{x:150+depth*340,y:65+row++*100});if(parent)branches.add(JSON.stringify([parent,path]));for(const child of children.get(path))visit(child,depth+1,path);}
 const sorted=[...names].sort();for(const p of sorted.filter(p=>!incoming.has(p)))visit(p,0,null);for(const p of sorted)visit(p,0,null);
 return {positions,branches,width:Math.max(700,300+maxDepth*340),height:Math.max(260,row*100+35)};
}

// Compute a fixed canvas for the snapshot, independent of selection and filtering.
export function stableGraphLayout(nodes, edges) {
 const changed=nodes.filter(n=>n.changed), layout=layoutGraph(changed,edges);
 const contexts=nodes.filter(n=>!n.changed).sort((a,b)=>a.path.localeCompare(b.path));
 const contextX=Math.max(150,...[...layout.positions.values()].map(p=>p.x))+340;
 let attached=0;
 for(const node of contexts){
   const relation=edges.find(e=>(e.source===node.path && layout.positions.has(e.target)) || (e.target===node.path && layout.positions.has(e.source)));
   if(!relation)continue;
   const parent=relation.source===node.path?relation.target:relation.source;
   layout.positions.set(node.path,{x:contextX,y:65+(changed.length+attached)*100});
   layout.branches.add(JSON.stringify([relation.source,relation.target]));attached++;
 }
 // Remaining context can still be reached by choosing a context node.
 for(const node of contexts) if(!layout.positions.has(node.path))layout.positions.set(node.path,{x:contextX,y:65+(changed.length+attached++)*100});
 layout.width=Math.max(layout.width,contexts.length?contextX+150:0);
 layout.height=Math.max(260,(nodes.length)*100+35);
 return layout;
}

export function revealGraphPath(revealed, path, edges) {
 const next=new Set(revealed); next.add(path);
 for(const edge of edges){if(edge.source===path)next.add(edge.target);if(edge.target===path)next.add(edge.source);}
 return next;
}
export function fileCommentCount(comments, path) {
 return comments.filter(comment=>comment.path===path).length;
}

export function routeGraphEdges(edges, positions) {
 const key=e=>JSON.stringify([e.source,e.target,e.kind,e.change]);
 const sorted=edges.filter(e=>positions.has(e.source)&&positions.has(e.target)).slice().sort((a,b)=>key(a).localeCompare(key(b)));
 const ports=new Map(), lanes=new Map();
 for(const e of sorted){
  const a=positions.get(e.source),b=positions.get(e.target), forward=b.x>a.x;
  const sourceSide=forward || b.x===a.x ? 1:-1, targetSide=forward?-1:1;
  for(const [path,side] of [[e.source,sourceSide],[e.target,targetSide]]){const k=JSON.stringify([path,side]);if(!ports.has(k))ports.set(k,[]);ports.get(k).push(e);}
  const k=JSON.stringify([b.x,forward]);if(!lanes.has(k))lanes.set(k,[]);lanes.get(k).push(e);
 }
 return new Map(sorted.map(e=>{
  const a=positions.get(e.source),b=positions.get(e.target),forward=b.x>a.x;
  const sourceSide=forward || b.x===a.x?1:-1,targetSide=forward?-1:1;
  const offset=(path,side)=>{const list=ports.get(JSON.stringify([path,side]));return (list.indexOf(e)-(list.length-1)/2)*Math.min(6,36/Math.max(1,list.length-1));};
  const group=lanes.get(JSON.stringify([b.x,forward])),slot=group.indexOf(e);
  const lane=forward?b.x-205+(slot+1)*80/(group.length+1):b.x+135+slot*8;
  const sy=a.y+offset(e.source,sourceSide),ty=b.y+offset(e.target,targetSide);
  return [e, {path:`M${a.x+sourceSide*115} ${sy} H${lane} V${ty} H${b.x+targetSide*115}`, lane, sy, ty}];
 }));
}

export function graphZoom(value) {
 return Math.max(0.25,Math.min(3,value));
}
