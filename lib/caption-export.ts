import { captionVisual, type Caption } from './captions'
export function downloadText(captions: Caption[]) {
  const text=captions.map((caption,index)=>`${index+1}. ${caption.content}\nBy ${caption.authorName} · ${caption.style}`).join('\n\n')
  saveBlob(new Blob([text],{type:'text/plain;charset=utf-8'}),'punchline-captions.txt')
}
function saveBlob(blob: Blob, filename: string) {
  const url=URL.createObjectURL(blob)
  const link=document.createElement('a')
  link.href=url; link.download=filename
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export async function downloadMeme(caption: Caption) {
  const visual=captionVisual(caption)
  const response=await fetch(visual.src,{credentials:'same-origin'})
  if (!response.ok) throw new Error('Image could not load')
  const url=URL.createObjectURL(await response.blob())
  try {
    const image=new Image()
    image.src=url
    await image.decode()
    const canvas=document.createElement('canvas')
    canvas.width=900; canvas.height=900
    const context=canvas.getContext('2d')
    if (!context) throw new Error('Image export unavailable')
    context.fillStyle='#f3efdf'; context.fillRect(0,0,900,900)
    const fit=Math.min(900/image.naturalWidth,620/image.naturalHeight)
    context.drawImage(image,(900-image.naturalWidth*fit)/2,(620-image.naturalHeight*fit)/2,image.naturalWidth*fit,image.naturalHeight*fit)
    context.fillStyle='#17180f'; context.fillRect(0,620,900,280)
    context.fillStyle='#f3efdf'; context.textAlign='center'
    let fontSize=38
    let lines:string[]=[]
    // Fit the complete caption inside its box, including wide glyphs and old
    // longer captions. Attribution occupies a separate area below the text.
    while (true) {
      context.font=`600 ${fontSize}px Arial`
      lines=[]
      let line=''
      for (const word of caption.content.split(/\s+/)) {
        const next=line ? `${line} ${word}` : word
        if (context.measureText(next).width>800 && line) {lines.push(line);line=word} else line=next
      }
      if (line) lines.push(line)
      if (lines.length*fontSize*1.25<=190 || fontSize<=16) break
      fontSize-=2
    }
    const lineHeight=Math.min(fontSize*1.25,190/Math.max(1,lines.length))
    const startY=640+(190-lines.length*lineHeight)/2+fontSize
    lines.forEach((text,index)=>context.fillText(text,450,startY+index*lineHeight,800))
    context.font='18px Arial'; context.fillStyle='#e7c65b'; context.fillText(`Punchline · AI caption by ${caption.authorName}`,450,865,800)
    const blob=await new Promise<Blob|null>((resolve)=>canvas.toBlob(resolve,'image/png'))
    if (!blob) throw new Error('Image export unavailable')
    saveBlob(blob,`punchline-${caption.id}.png`)
  } finally {URL.revokeObjectURL(url)}
}
