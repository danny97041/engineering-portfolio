export function heat(canvas,values,n,lo,hi) {
  canvas.width=n;canvas.height=n;
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(n,n);
  const colors=[[20,40,70],[31,98,119],[49,165,151],[164,216,149],[255,224,112]];
  values.forEach((v,i)=>{
    const x=i%n,y=n-1-Math.floor(i/n),k=(y*n+x)*4;
    const s=Math.max(0,Math.min(1,(v-lo)/(hi-lo||1)))*4;
    const j=Math.min(3,Math.floor(s));
    for(let c=0;c<3;c++) image.data[k+c]=Number.isFinite(v)?colors[j][c]+(s-j)*(colors[j+1][c]-colors[j][c]):196;
    image.data[k+3]=255;
  });
  ctx.putImageData(image,0,0);
}
export function lines(canvas,series,xLabel,yLabel) {
  const w=750,h=225,left=78,bottom=40,top=14,right=12;
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');
  const points=series.flatMap(s=>s.values).filter(p=>p.every(Number.isFinite));
  if(!points.length)return;
  const xx=points.map(p=>p[0]),yy=points.map(p=>p[1]);
  const xmin=Math.min(...xx),xmax=Math.max(...xx),ymin=Math.min(...yy),ymax=Math.max(...yy);
  const px=x=>left+(x-xmin)/(xmax-xmin||1)*(w-left-right);
  const py=y=>h-bottom-(y-ymin)/(ymax-ymin||1)*(h-bottom-top);
  ctx.font='13px sans-serif';ctx.fillStyle='#405a55';ctx.strokeStyle='#cad9d2';
  for(let i=0;i<=3;i++){const y=ymin+(ymax-ymin)*i/3;ctx.beginPath();ctx.moveTo(left,py(y));ctx.lineTo(w-right,py(y));ctx.stroke();ctx.fillText(y.toPrecision(3),5,py(y)+4);}
  ctx.fillText(String(xmin.toPrecision(3)),left,h-18);ctx.fillText(String(xmax.toPrecision(3)),w-53,h-18);ctx.fillText(xLabel,w/2,h-7);
  canvas.setAttribute('aria-label',yLabel+' by '+xLabel);
  for(const s of series){ctx.beginPath();ctx.lineWidth=2;ctx.strokeStyle=s.color;s.values.forEach(([x,y],i)=>i?ctx.lineTo(px(x),py(y)):ctx.moveTo(px(x),py(y)));ctx.stroke();}
}
