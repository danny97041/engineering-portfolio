export const $ = id => document.getElementById(id);
export function h(tag, attrs={}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if (key === 'class') node.className=value;
    else if (key === 'value') node.value=value;
    else node.setAttribute(key,value===true?'':value);
  }
  node.append(...children.flat(Infinity).filter(child=>child!==null && child!==undefined && child!==false));
  return node;
}
export function button(label,handler,attrs={}) {
  return h('button',{type:'button',onclick:handler,...attrs},label);
}
export const ordered = (items, key) => [...items].sort((a,b)=>String(key(a) ?? '\uffff').localeCompare(String(key(b) ?? '\uffff')));
export const valueText = value => value === null || value === undefined || value === '' ? '—' : String(value);
export function select(items,value,callback,attrs={}) {
  const element = h('select',{...attrs,onchange:callback && (event=>callback(event.target.value))},
    items.map(([key,label])=>h('option',{value:key},label)));
  element.value=value ?? '';
  return element;
}
export function table(headers,rows,label,empty) {
  if (!rows.length) return h('p',{class:'card muted'},empty);
  return h('div',{class:'table-wrap',tabindex:'0',role:'region','aria-label':label},
    h('table',{},h('thead',{},h('tr',{},headers.map(label=>h('th',{scope:'col'},label)))),
      h('tbody',{},rows.map(row=>h('tr',{},row.map(cell=>h('td',{},cell)))))));
}
export function download(name,text,type) {
  const blob = new Blob([type==='text/csv'?'\ufeff':'',text],{type:type+';charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = h('a',{href:url,download:name});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
