/* pv-anyedit · 任意元素编辑层
   默认开启。点任意元素（含 SVG 图表里的数字）→ 浮出工具条：
   字号 / 字体 / 宽高 / 内外距 / 文字色 / 底色 / 上移下移 / 复制 / 改源码 / 删除 / 撤销。
   SVG 文字支持：改字号、改颜色、改文字内容、四向微调、删除。
   所有改动写进 <script id="pv-anyedit-data">，随文件保存与转发。 */
(function(){
  'use strict';
  var INK='#092C61';
  var ON=true, SEL=null, HOVER=null, HIST=[], box=null, bar=null, WATCH={}, EDITING=null, fsEl=null, fsTarget=null;

  function $(id){ return document.getElementById(id); }
  function dataEl(){ return $('pv-anyedit-data'); }
  function loadData(){
    var d=dataEl(); if(!d) return {};
    try{ return JSON.parse(d.textContent||'{}')||{}; }catch(e){ return {}; }
  }
  function saveData(o){
    var d=dataEl(); if(!d) return;
    d.textContent=JSON.stringify(o);
    try{ document.dispatchEvent(new Event('pv-anyedit-saved')); }catch(e){}
  }
  function curStore(){ var d=loadData(); if(!d.styles) d.styles={}; return d; }
  function isSVG(el){ return !!(el && el.namespaceURI && el.namespaceURI.indexOf('svg')>=0); }
  function keyOf(el){
    if(!el||!el.tagName) return null;
    if(el.id) return '#'+el.id;
    var path=[], n=el, g=0;
    while(n && n.nodeType===1 && g<6){
      var tag=n.tagName.toLowerCase(), k=1, s=n.previousElementSibling;
      while(s){ if(s.tagName===n.tagName) k++; s=s.previousElementSibling; }
      path.unshift(tag+':'+k);
      if(n.id){ path.unshift('#'+n.id); break; }
      n=n.parentNode; g++;
    }
    return path.join('>');
  }
  function setStyleProp(el,prop,val){
    if(!el||!el.style) return;
    if(val===null||val===undefined||val==='') el.style.removeProperty(prop);
    else el.style.setProperty(prop,val);
  }
  function writeStyle(key,prop,val,prev){
    var d=curStore();
    if(!d.styles[key]) d.styles[key]={};
    if(val===null||val===undefined||val==='') delete d.styles[key][prop];
    else d.styles[key][prop]=val;
    saveData(d);
    pushHist({t:'style',key:key,prop:prop,prev:(prev===undefined?null:prev)});
  }
  function allRoots(){
    var out=[document], ids=Object.keys(loadData().frozen||{}), i;
    for(i=0;i<ids.length;i++){ var e=$(ids[i]); if(e) out.push(e); }
    return out;
  }
  function applyStyles(){
    var st=loadData().styles||{}, roots=allRoots(), r, i, el, k, p;
    for(r=0;r<roots.length;r++){
      var cands=roots[r].querySelectorAll('*');
      for(i=0;i<cands.length;i++){
        el=cands[i];
        if(isSVG(el)) continue;
        k=keyOf(el);
        if(k && st[k]){ for(p in st[k]){ if(Object.prototype.hasOwnProperty.call(st[k],p)) setStyleProp(el,p,st[k][p]); } }
      }
    }
  }
  function pushHist(a){ HIST.push(a); if(HIST.length>50) HIST.shift(); }
  function freeze(el){
    try{
      var host=el;
      while(host && host!==document.body && !host.id) host=host.parentNode;
      if(!host||host===document.body||!host.id) return;
      var d=curStore(); d.frozen=d.frozen||{}; d.frozen[host.id]=host.innerHTML; saveData(d);
      watch(host);
    }catch(e){}
  }
  function watch(host){
    if(!host||WATCH[host.id]||!window.MutationObserver) return;
    WATCH[host.id]=true;
    var tries=0;
    var mo=new MutationObserver(function(){
      var snap=(loadData().frozen||{})[host.id];
      if(snap===undefined||snap===null) return;
      if(host.innerHTML!==snap){ tries++; if(tries<8) host.innerHTML=snap; else { mo.disconnect(); WATCH[host.id]=false; } }
    });
    try{ mo.observe(host,{childList:true,subtree:false}); }catch(e){}
  }
  function applyFrozen(){
    var f=loadData().frozen||{}, k, host;
    for(k in f){ if(!Object.prototype.hasOwnProperty.call(f,k)) continue;
      host=$(k); if(host && host.innerHTML!==f[k]) host.innerHTML=f[k]; }
  }
  function applyHidden(){
    var h=loadData().hidden||{}, k, e;
    for(k in h){ if(!Object.prototype.hasOwnProperty.call(h,k)) continue;
      e=$(k); if(e && e.parentNode) e.parentNode.removeChild(e); }
  }
  function undo(){
    var a=HIST.pop(); if(!a) return toast('没有可撤销的操作');
    if(a.t==='del'){
      var host=a.parent;
      if(host && host.parentNode!==null){
        try{
          if(a.next && a.next.parentNode===host) host.insertBefore(a.node, a.next);
          else if(a.idx>=0 && a.idx<=host.children.length) host.insertBefore(a.node, host.children[a.idx]||null);
          else host.appendChild(a.node);
          var dd=curStore();
          if(dd.hidden && dd.hidden[a.id]){ delete dd.hidden[a.id]; saveData(dd); }
          refit(host);
          freeze(host);
          toast('已恢复');
          return;
        }catch(e){}
      }
      toast('无法恢复（容器已变化）'); return;
    }
    if(a.t==='html'){ var e=$(a.id); if(e&&e.parentNode) e.parentNode.removeChild(e); }
    else if(a.t==='style'){ writeStyle(a.key,a.prop,a.prev); applyStyles(); }
    toast('已撤销');
  }

  /* 自动补位：删/恢复之后把列数收紧或还原，让剩下的元素铺满一行 */
  function refit(parent){
    try{
      if(!parent||parent.nodeType!==1) return;
      var cs=getComputedStyle(parent);
      if(cs.display!=='grid') return;
      var cur=(cs.gridTemplateColumns||'').split(/\s+/).filter(function(x){ return x&&x!=='none'; }).length;
      var orig=parseInt(parent.getAttribute('data-pae-cols')||'0',10);
      if(!orig||orig<1){ parent.setAttribute('data-pae-cols', String(cur)); orig=cur; }
      var n=parent.children.length;
      var target=Math.min(orig, n);
      if(n>=2 && target>=2 && target!==cur){
        parent.style.setProperty('grid-template-columns','repeat('+target+',1fr)');
      }
    }catch(e){}
  }
  function doDelete(el){
    if(!el||!el.parentNode) return;
    var parent=el.parentNode;
    var id=el.id||('pae-'+Date.now());
    el.id=id;
    var idx=[].indexOf.call(parent.children, el);
    var hist={t:'del', id:id, node:el, parent:parent, idx:idx, next:el.nextElementSibling||null, isSvg:isSVG(el)};
    parent.removeChild(el);
    var d=curStore(); d.hidden=d.hidden||{}; d.hidden[id]=true; saveData(d);
    refit(parent);
    freeze(parent);
    pushHist(hist);
    if(SEL===el){ SEL=null; hideBar(); }
    toast('已删除（按 Ctrl+Z 撤销，其余元素已自动补位）');
  }
  function toast(msg){
    var t=document.createElement('div'); t.className='pae-toast'; t.textContent=msg;
    document.body.appendChild(t); setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); },2000);
  }
  function place(){
    if(!SEL||!bar) return;
    var r=SEL.getBoundingClientRect();
    var vw=window.innerWidth||document.documentElement.clientWidth||1200;
    var vh=window.innerHeight||document.documentElement.clientHeight||800;
    var bw=bar.offsetWidth||320, bh=bar.offsetHeight||34;
    /* 工具条是 position:fixed → 用视口坐标；优先放在元素上方，放不下就放下方 */
    var top=r.top-bh-6;
    if(top<4) top=r.bottom+6;
    if(top+bh>vh-4) top=Math.max(4, vh-bh-4);
    var left=Math.max(6, Math.min(r.left, vw-bw-8));
    bar.style.top=Math.round(top)+'px';
    bar.style.left=Math.round(left)+'px';
  }
  function hideBar(){ if(bar) bar.classList.remove('show'); }
  function deselect(){
    if(EDITING){ try{ EDITING.removeAttribute('contenteditable'); }catch(e){} EDITING=null; }
    if(SEL){ SEL.classList.remove('pae-hl'); SEL.removeAttribute('data-pae-sel'); }
    SEL=null; pinFs(null); hideBar();
  }

  /* ---------- UI ---------- */
  function buildUI(){
    box=document.createElement('div'); box.id='pvanyedit-ui';
    box.innerHTML='<button type="button" class="pae-btn pae-toggle" data-pae="toggle">✎ 任意编辑：开</button>'+
                  '<button type="button" class="pae-btn pae-save" data-pae="save" title="直接覆盖保存当前文件（等于 Ctrl+S），不会弹任何窗口">💾 保存</button>'+
                  '<button type="button" class="pae-btn pae-auth" data-pae="auth" title="只需一次：授权这个文件夹后，以后 Ctrl+S 直接保存，不再弹任何窗口">📁 授权文件夹（一次）</button>'+
                  '<div class="pae-fs" data-pae="fs">'+
                    '<button type="button" class="pae-fsbtn" data-fs="-1" title="缩小一档">A−</button>'+
                    '<span class="pae-fsval" data-fs="val">—</span>'+
                    '<button type="button" class="pae-fsbtn" data-fs="1" title="放大一档">A+</button>'+
                  '</div>'+
                  '<div class="pae-toolbar" data-pae="bar"></div>';
    document.body.appendChild(box);
    fsEl=box.querySelector('[data-pae="fs"]');
    bar=box.querySelector('[data-pae="bar"]');
    bar.addEventListener('click', onBarClick, false);
    bar.addEventListener('change', onBarChange, false);
    bar.addEventListener('input', onBarInput, false);
    box.addEventListener('click', function(e){
      var fs=e.target.closest('[data-fs]');
      if(fs){ e.preventDefault(); e.stopPropagation(); stepFs(parseInt(fs.getAttribute('data-fs'),10)); return; }
      var tg=e.target.closest('[data-pae="toggle"]');
      if(tg){ e.preventDefault(); e.stopPropagation(); setOn(!ON); return; }
      var sv=e.target.closest('[data-pae="save"]');
      if(sv){ e.preventDefault(); e.stopPropagation(); saveCurrent(e.altKey); return; }
      var au=e.target.closest('[data-pae="auth"]');
      if(au){ e.preventDefault(); e.stopPropagation(); authFolder(); return; }
    }, false);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', function(){ place(); if(fsEl&&fsEl.classList.contains('show')&&fsTarget) showFs(fsTarget); }, {passive:true});
    window.addEventListener('resize', function(){ place(); if(fsEl&&fsEl.classList.contains('show')&&fsTarget) showFs(fsTarget); }, {passive:true});
    document.addEventListener('mouseleave', function(){ if(!fsPinned) hideFs(); }, true);
  }
  function setOn(v){
    ON=v;
    var b=box.querySelector('[data-pae="toggle"]');
    b.className='pae-btn pae-toggle'+(ON?' on':'');
    b.textContent=ON?'✎ 任意编辑：开':'✎ 任意编辑：关';
    if(!ON){ if(HOVER) HOVER.classList.remove('pae-hl2'); deselect(); }
    toast(ON?'编辑已开启：点任意元素出现工具条（Alt+点击可穿透链接）':'编辑已关闭，可正常浏览');
  }
  var PASS='#pvanyedit-ui, #pvnt-root, nav#tabs, .pager, #hint, details > summary, [data-goto]';

  /* ---------- 每块文字右侧的 A− / A+ 字号微调 ---------- */
  var FS_STEPS=[10,10.5,11,12,12.6,13,14,15,16,17,18,20,21,22,24,26,28,30,32,36,40,44,48,56];
  var INLINE={B:1,STRONG:1,I:1,EM:1,SPAN:1,A:1,SMALL:1,CODE:1,SUB:1,SUP:1,BR:1,MARK:1,U:1,S:1,FONT:1,LABEL:1};
  var SKIP={'SECTION':1,'MAIN':1,'BODY':1,'HTML':1,'TABLE':1,'TBODY':1,'THEAD':1,'TFOOT':1,'TR':1,'UL':1,'OL':1,'NAV':1,'FOOTER':1,'HEADER':1,'SCRIPT':1,'STYLE':1};
  var fsPinned=null, fsHideT=null;
  function isFsTarget(el){
    if(!el||el.nodeType!==1) return false;
    if(SKIP[el.tagName]) return false;
    if(el.children&&el.children.length>8) return false;
    if(el.closest&&(el.closest('#pvanyedit-ui')||el.closest('#pvnt-root'))) return false;
    return (el.textContent||'').trim().length>0;
  }
  function blockOf(el){
    if(isSVG(el)){ var t=(el.tagName.toLowerCase()==='text')?el:el.closest('text'); return t||null; }
    var n=el, g=0;
    while(n && n.nodeType===1 && g<5){
      if(!SKIP[n.tagName] && !INLINE[n.tagName] && isFsTarget(n)) return n;
      n=n.parentNode; g++;
    }
    return isFsTarget(el)?el:null;
  }
  function curFs(el){
    if(!el) return null;
    if(isSVG(el)){ var v=parseFloat(el.getAttribute('font-size')||el.style.fontSize||'10.5'); return isNaN(v)?null:v; }
    try{ var f=parseFloat(getComputedStyle(el).fontSize); return isNaN(f)?null:f; }catch(e){ return null; }
  }
  function reservedZones(){
    var out=[], i, sel=['.pae-toggle','.pae-save','.pager'];
    for(i=0;i<sel.length;i++){
      var e=document.querySelector(sel[i]);
      if(!e) continue;
      var r=e.getBoundingClientRect();
      if(r.width>0&&r.height>0) out.push(r);
    }
    return out;
  }
  function showFs(el){
    if(!fsEl||!el) return;
    fsTarget=el;
    var cur=curFs(el);    var lab=fsEl.querySelector('[data-fs="val"]');
    if(lab) lab.textContent=(cur?Math.round(cur*10)/10:'—')+'px';
    var r=el.getBoundingClientRect();
    var w=fsEl.offsetWidth||104, h=fsEl.offsetHeight||26;
    var vw=window.innerWidth||document.documentElement.clientWidth||1200;
    var vh=window.innerHeight||document.documentElement.clientHeight||800;
    var left=r.right+8;
    if(left+w>vw-8) left=vw-w-10;              /* 整行宽的文字：一律贴屏幕右侧 */
    if(left<6) left=6;
    var top=r.top+Math.min(24, Math.max(0, r.height/2-13));
    /* 避开右下角那三个固定按钮，别被压住 */
    var zones=reservedZones(), z;
    for(z=0;z<zones.length;z++){
      var q=zones[z];
      if(left<q.right+10 && left+w>q.left-10 && top<q.bottom+10 && top+h>q.top-10){
        top=Math.min(top, q.top-h-10);
      }
    }
    if(top<6) top=6;
    if(top+h>vh-6) top=Math.max(6, vh-h-6);
    fsEl.style.left=Math.round(left)+'px';
    fsEl.style.top=Math.round(top)+'px';
    var flush=(left+w>vw-12);
    fsEl.className='pae-fs show'+(flush?' pae-fs-flush':'');
    fsEl.setAttribute('title', tagLabel(el)+' · 当前 '+(cur||'?')+'px');
  }
  function hideFs(){ if(fsHideT){ clearTimeout(fsHideT); fsHideT=null; } if(fsEl) fsEl.classList.remove('show'); }
  function hideFsSoon(){                       /* 给鼠标 500ms 走到按钮上 */
    if(fsPinned) return;
    if(fsHideT) clearTimeout(fsHideT);
    fsHideT=setTimeout(function(){ fsHideT=null; if(!fsPinned) hideFs(); }, 500);
  }
  function cancelHide(){ if(fsHideT){ clearTimeout(fsHideT); fsHideT=null; } }
  function pinFs(el){ fsPinned=el||null; cancelHide(); if(el) showFs(el); else hideFs(); }
  function stepFs(dir){
    var el=fsTarget; if(!el) return;
    var cur=curFs(el); if(!cur) return;
    var i, idx=0, best=1e9;
    for(i=0;i<FS_STEPS.length;i++){ var dd=Math.abs(FS_STEPS[i]-cur); if(dd<best){ best=dd; idx=i; } }
    var ni=Math.max(0,Math.min(FS_STEPS.length-1, idx+dir));
    var nv=FS_STEPS[ni];
    if(isSVG(el)){ el.setAttribute('font-size', String(nv)); freeze(el); place(); }
    else{
      var key=keyOf(el), d=curStore();
      var prev=(d.styles[key]&&d.styles[key]['font-size'])||'';
      writeStyle(key,'font-size',nv+'px',prev);
      setStyleProp(el,'font-size',nv+'px');
      freeze(el);
    }
    var lab=fsEl.querySelector('[data-fs="val"]');
    if(lab) lab.textContent=nv+'px';
    if(fsPinned && fsPinned.isConnected!==false) showFs(fsPinned);
    toast('字号 '+nv+'px');
    if(dir>0&&ni===FS_STEPS.length-1) toast('已经是最大档');
    if(dir<0&&ni===0) toast('已经是最小档');
  }

  function onClick(e){
    if(!ON) return;
    var t=e.target;
    if(!t||!t.closest) return;
    if(t.closest('#pvanyedit-ui')) return;
    if(t.closest('#pvnt-root')) return;
    if(EDITING && EDITING.contains && EDITING.contains(t)) return;   /* 正在改字：放行浏览器默认（放光标） */
    if(!e.altKey && t.closest(PASS)) return;      /* 导航 / 分页 / 折叠面板照常工作 */
    e.preventDefault(); e.stopPropagation();
    if(EDITING){ endEdit(); }
    if(SEL){ SEL.classList.remove('pae-hl'); SEL.removeAttribute('data-pae-sel'); }
    SEL=t; SEL.classList.add('pae-hl'); SEL.setAttribute('data-pae-sel','1');
    pinFs(isFsTarget(t)?t:blockOf(t));         /* 点选后字号按钮钉住，鼠标挪过去也不会消失 */
    buildBar();
  }
  function endEdit(){
    if(!EDITING) return;
    try{ EDITING.removeAttribute('contenteditable'); }catch(e){}
    var el=EDITING; EDITING=null;
    if(el && el.parentNode) freeze(el);
  }
  function startEdit(el){
    if(!el||!el.parentNode) return;
    if(isSVG(el)){
      var v=window.prompt('修改这个数字 / 文字：', el.textContent);
      if(v===null) return;
      el.textContent=v; freeze(el); place(); toast('已改文字');
      return;
    }
    if(EDITING && EDITING!==el) endEdit();
    el.setAttribute('contenteditable','true');
    EDITING=el;
    try{ el.focus(); }catch(e){}
    try{
      var r=document.createRange(); r.selectNodeContents(el);
      var s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }catch(err){}
    toast('直接改字，点空白处生效（Esc 也可以）');
  }
  function onDblClick(e){
    if(!ON) return;
    var t=e.target;
    if(!t||!t.closest) return;
    if(t.closest('#pvanyedit-ui')||t.closest('#pvnt-root')) return;
    if(t.closest(PASS) && !e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    startEdit(t);
  }
  function onOver(e){
    if(!ON) return;
    var t=e.target; if(!t||!t.closest) return;
    if(t.closest('#pvanyedit-fs')||t.closest('[data-pae="fs"]')){ cancelHide(); return; }   /* 鼠标在字号按钮上：保持 */
    if(t.closest('#pvanyedit-ui')||t.closest('#pvnt-root')) return;
    if(HOVER) HOVER.classList.remove('pae-hl2');
    HOVER=t;
    if(t.tagName!=='HTML'&&t.tagName!=='BODY') t.classList.add('pae-hl2');
    if(fsPinned){ cancelHide(); return; }      /* 已点选：字号按钮钉在选中的那块上，不跟着乱跳 */
    var tg=blockOf(t);
    if(!tg||!isFsTarget(tg)){ hideFsSoon(); return; }
    /* 鼠标从内层往外走时会经过外层容器 —— 这种情况不要换目标，否则按钮会跳走 */
    if(fsTarget && fsEl && fsEl.classList.contains('show') && tg!==fsTarget && tg.contains(fsTarget)){ cancelHide(); return; }
    cancelHide();
    showFs(tg);
  }
  function onKey(e){
    if(!ON) return;
    var t=e.target||{};
    var inField = (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable) && !t.closest('#pvanyedit-ui');
    if(e.key==='Escape'){ if(EDITING){ endEdit(); } else { deselect(); } return; }
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&String(e.key).toLowerCase()==='s'){
      e.preventDefault(); e.stopImmediatePropagation();
      saveCurrent(e.altKey);      /* Ctrl+S = 保存；Alt+Ctrl+S = 强制走"覆盖原文件"（必要时弹一次授权） */
      return;
    }
    if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='z'&&!EDITING){ e.preventDefault(); undo(); return; }
    if(inField||EDITING) return;
    if((e.key==='Delete'||e.key==='Backspace') && SEL){
      e.preventDefault(); e.stopPropagation();
      doDelete(SEL);
    }
  }
  function tagLabel(el){
    var tag=el.tagName.toLowerCase();
    var id=el.id?('#'+el.id):'';
    var cls=(typeof el.className==='string'&&el.className.trim())?('.'+el.className.trim().split(/\s+/).slice(0,2).join('.')):'';
    var txt=(el.textContent||'').trim().slice(0,14);
    return tag+id+cls+(isSVG(el)?('  「'+txt+'」'):'');
  }
  function num(v){ var m=String(v||'').match(/-?\d+(\.\d+)?/); return m?m[0]:''; }

  function buildBar(){
    var el=SEL; if(!el) return;
    var i;
    if(isSVG(el)){ buildSvgBar(el); return; }
    var opts='<option value="">字号…</option>';
    var sizes=[12,13,14,15,16,17,18,20,21,22,24,26,28,30,32,36,40,44,48,56];
    for(i=0;i<sizes.length;i++) opts+='<option value="'+sizes[i]+'px">'+sizes[i]+'px</option>';
    var fonts='<option value="">字体…</option><option value="inherit">跟随正文</option><option value="Arial,Helvetica,sans-serif">Arial</option><option value="KaiTi,楷体,serif">楷体</option><option value="SimSun,宋体,serif">宋体</option><option value="Microsoft YaHei,微软雅黑,sans-serif">雅黑</option>';
    var colors=['','#092C61','#1c1c1e','#727375','#C2170A','#159788','#E0731A'], sw='';
    for(i=0;i<colors.length;i++){
      sw+=colors[i]?'<span class="pae-swatch" data-pae="color" data-val="'+colors[i]+'" style="background:'+colors[i]+'" title="文字色 '+colors[i]+'"></span>'
                   :'<span class="pae-swatch" data-pae="color" data-val="" style="background:#fff" title="清除文字色"></span>';
    }
    var bgs=['','#FDF3AD','#eaf1fa','#e6f4f2','#fdecea','#ffffff'], bsw='';
    for(i=0;i<bgs.length;i++){
      bsw+=bgs[i]?'<span class="pae-swatch" data-pae="bg" data-val="'+bgs[i]+'" style="background:'+bgs[i]+'" title="底色 '+bgs[i]+'"></span>'
                  :'<span class="pae-swatch" data-pae="bg" data-val="" style="background:#fff" title="清除底色"></span>';
    }
    var cs=getComputedStyle(el);
    bar.innerHTML=
      '<span class="pae-name" title="'+tagLabel(el)+'">'+tagLabel(el)+'</span><span class="pae-sep"></span>'+
      '<select class="pae-inp wide" data-pae="size" title="字号">'+opts+'</select>'+
      '<select class="pae-inp wide" data-pae="font" title="字体">'+fonts+'</select>'+
      '<input class="pae-inp" data-pae="w" placeholder="宽" title="宽度：数字=px，可填 auto / 60%" value="'+num(cs.width)+'">'+
      '<input class="pae-inp" data-pae="h" placeholder="高" title="高度" value="'+num(cs.height)+'">'+
      '<input class="pae-inp" data-pae="pad" placeholder="内距" title="内边距" value="'+num(cs.paddingTop)+'">'+
      '<input class="pae-inp" data-pae="mar" placeholder="外距" title="外边距" value="'+num(cs.marginTop)+'">'+
      '<span class="pae-sep"></span>'+sw+bsw+'<span class="pae-sep"></span>'+
      '<button type="button" class="pae-btn" data-pae="up" title="上移">&uarr;</button>'+
      '<button type="button" class="pae-btn" data-pae="down" title="下移">&darr;</button>'+
      '<button type="button" class="pae-btn" data-pae="dup" title="复制">&boxbox;</button>'+
      '<button type="button" class="pae-btn" data-pae="edit" title="改文字（也可直接双击）">A</button>'+
      '<button type="button" class="pae-btn" data-pae="src" title="改标签 / class / 源码">&lt;/&gt;</button>'+
      '<button type="button" class="pae-btn" data-pae="undo" title="撤销上一步">&#8630;</button>'+
      '<button type="button" class="pae-btn" data-pae="del" style="color:#C2170A" title="删除这个元素">&times; 删除</button>'+
      '<span class="pae-hint">选中后按 Delete / ⌫ 也可删除，其余元素自动补位</span>';
    bar.style.left='6px';
    bar.classList.add('show');
    place();
    setTimeout(place, 0);          /* 字体/换行落定后再校一次 */
  }
  function buildSvgBar(el){
    var i, fs=el.getAttribute('font-size')||'10.5';
    var opts='<option value="">字号…</option>';
    var sizes=[8,9,10,10.5,11,12,13,14,16,18,20,24,28];
    for(i=0;i<sizes.length;i++) opts+='<option value="'+sizes[i]+'"'+(String(sizes[i])===String(fs)?' selected':'')+'>'+sizes[i]+'px</option>';
    var colors=['#092C61','#1c1c1e','#727375','#C2170A','#159788','#E0731A','#ffffff','#3f6ea8'], sw='';
    var cur=el.getAttribute('fill')||'';
    for(i=0;i<colors.length;i++){
      sw+='<span class="pae-swatch" data-pae="fill" data-val="'+colors[i]+'" style="background:'+colors[i]+(colors[i]==='#ffffff'?';box-shadow:0 0 0 1px #c9ced3':'')+'" title="颜色 '+colors[i]+'"></span>';
    }
    bar.innerHTML=
      '<span class="pae-name" title="'+tagLabel(el)+'">'+tagLabel(el)+'</span><span class="pae-sep"></span>'+
      '<select class="pae-inp wide" data-pae="size">'+opts+'</select>'+
      '<input class="pae-inp wide" data-pae="txt" placeholder="文字" value="'+(el.textContent||'').replace(/"/g,'&quot;')+'">'+
      '<span class="pae-sep"></span>'+sw+'<span class="pae-sep"></span>'+
      '<button type="button" class="pae-btn" data-pae="left" title="左移">&larr;</button>'+
      '<button type="button" class="pae-btn" data-pae="right" title="右移">&rarr;</button>'+
      '<button type="button" class="pae-btn" data-pae="up2" title="上移">&uarr;</button>'+
      '<button type="button" class="pae-btn" data-pae="down2" title="下移">&darr;</button>'+
      '<button type="button" class="pae-btn" data-pae="undo" title="撤销上一步">&#8630;</button>'+
      '<button type="button" class="pae-btn" data-pae="del" style="color:#C2170A" title="删除这个标签">&times; 删除</button>'+
      '<span class="pae-hint">当前色 '+(cur||'默认')+' · 按 Delete 也可删</span>';
    bar.style.left='6px';
    bar.classList.add('show');
    place();
    setTimeout(place, 0);
  }

  function svgShift(el,dx,dy){
    var t=el.getAttribute('transform')||'';
    var m=t.match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
    if(m){ dx+=parseFloat(m[1]); dy+=parseFloat(m[2]); t=t.replace(/translate\([^)]*\)/,'').trim(); }
    el.setAttribute('transform',(t?t+' ':'')+'translate('+dx+','+dy+')');
    freeze(el); place();
  }
  function onBarChange(e){
    var t=e.target; if(!t||!t.getAttribute||!SEL) return;
    var act=t.getAttribute('data-pae'), val=String(t.value||''); if(!val) return;
    if(isSVG(SEL)){
      if(act==='size'){ SEL.setAttribute('font-size',val.replace('px','')); freeze(SEL); place(); toast('字号 '+val); }
      return;
    }
    if(act!=='size'&&act!=='font') return;
    var prop=act==='size'?'font-size':'font-family';
    var key=keyOf(SEL), d=curStore();
    var prev=(d.styles[key]&&d.styles[key][prop])||'';
    writeStyle(key,prop,val,prev);
    setStyleProp(SEL,prop,val);
    freeze(SEL); toast(prop==='font-size'?('字号 '+val):'字体已改');
  }
  function onBarInput(e){
    var t=e.target; if(!t||!t.getAttribute||!SEL) return;
    var act=t.getAttribute('data-pae');
    if(isSVG(SEL)){
      if(act==='txt'){ SEL.textContent=String(t.value||''); freeze(SEL); place(); }
      return;
    }
    var prop=act==='w'?'width':act==='h'?'height':act==='pad'?'padding':act==='mar'?'margin':null;
    if(!prop) return;
    var v=String(t.value||'').trim();
    var val=v===''?'':(/^[0-9.]+$/.test(v)?v+'px':v);
    var key=keyOf(SEL), d=curStore();
    var prev=(d.styles[key]&&d.styles[key][prop])||'';
    writeStyle(key,prop,val,prev);
    setStyleProp(SEL,prop,val);
    freeze(SEL);
  }
  function onBarClick(e){
    var t=e.target.closest?e.target.closest('[data-pae]'):null;
    if(!t||t===bar) return;
    var act=t.getAttribute('data-pae');
    if(act==='bar'||act==='toggle') return;
    if(!SEL) return;
    e.preventDefault(); e.stopPropagation();
    var el=SEL, key=keyOf(el);
    if(act==='size'||act==='font'||act==='txt') return;
    if(act==='undo'){ undo(); return; }
    if(act==='del'){ doDelete(el); return; }
    if(isSVG(el)){
      if(act==='fill'){ el.setAttribute('fill',t.getAttribute('data-val')); freeze(el); place(); }
      else if(act==='left'){ svgShift(el,-8,0); }
      else if(act==='right'){ svgShift(el,8,0); }
      else if(act==='up2'){ svgShift(el,0,-8); }
      else if(act==='down2'){ svgShift(el,0,8); }
      return;
    }
    if(act==='color'){ var pc=curStore(); writeStyle(key,'color',t.getAttribute('data-val')||'',(pc.styles[key]&&pc.styles[key].color)||''); setStyleProp(el,'color',t.getAttribute('data-val')||''); freeze(el); }
    else if(act==='bg'){ var pb=curStore(); writeStyle(key,'background-color',t.getAttribute('data-val')||'',(pb.styles[key]&&pb.styles[key]['background-color'])||''); setStyleProp(el,'background-color',t.getAttribute('data-val')||''); freeze(el); }
    else if(act==='up'||act==='down'){
      var p=el.parentNode; if(!p) return;
      var sib=act==='up'?el.previousElementSibling:el.nextElementSibling;
      if(!sib){ toast(act==='up'?'已经在最前':'已经在最后'); return; }
      if(act==='up') p.insertBefore(el,sib); else p.insertBefore(sib,el);
      freeze(p); buildBar();
    }
    else if(act==='dup'){
      var clone=el.cloneNode(true); clone.removeAttribute('id');
      el.parentNode.insertBefore(clone,el.nextSibling);
      freeze(el.parentNode); toast('已复制');
    }
    else if(act==='edit'){ startEdit(el); }
    else if(act==='src'){
      var cur=el.outerHTML;
      var next=window.prompt('编辑 HTML 源码（标签 / class / style 均可改）：',cur);
      if(next===null||next===cur) return;
      var wrap=document.createElement('div'); wrap.innerHTML=next;
      if(!wrap.firstElementChild){ toast('源码无效'); return; }
      el.outerHTML=next; deselect(); toast('已应用源码');
    }
  }

  /* ---------- 一键保存：直接覆盖原文件，不弹任何窗口 ---------- */
  function withUiDetached(fn){
    var stash=[], marked=[], i, out;
    var ui=$('pvanyedit-ui');
    if(ui&&ui.parentNode){ stash.push(ui); ui.parentNode.removeChild(ui); }
    var ts=document.querySelectorAll('.pae-toast');
    for(i=0;i<ts.length;i++){ stash.push(ts[i]); if(ts[i].parentNode) ts[i].parentNode.removeChild(ts[i]); }
    var hl=document.querySelectorAll('.pae-hl, .pae-hl2');
    for(i=0;i<hl.length;i++){
      marked.push({el:hl[i], cls:hl[i].className, sel:hl[i].getAttribute('data-pae-sel'), ce:hl[i].getAttribute('contenteditable')});
      hl[i].classList.remove('pae-hl'); hl[i].classList.remove('pae-hl2');
      hl[i].removeAttribute('data-pae-sel'); hl[i].removeAttribute('contenteditable');
    }
    try{ out=fn(); }
    finally{
      for(i=0;i<marked.length;i++){
        var m=marked[i], e2=m.el;
        if(!e2||!e2.parentNode&&!document.contains(e2)) continue;
        if(m.cls!==null) e2.className=m.cls;
        if(m.sel!==null) e2.setAttribute('data-pae-sel',m.sel);
        if(m.ce!==null) e2.setAttribute('contenteditable',m.ce);
      }
      for(i=0;i<stash.length;i++){ if(!stash[i].parentNode) document.body.appendChild(stash[i]); }
    }
    return out;
  }
  function scrubSnap(html){
    if(typeof html!=='string') return html;
    return html
      .replace(/\sclass="([^"]*)"/g, function(m,c){
        var nc=c.split(/\s+/).filter(function(x){ return x && x!=='pae-hl' && x!=='pae-hl2'; }).join(' ');
        return nc?(' class="'+nc+'"'):'';
      })
      .replace(/\sdata-pae-sel="[^"]*"/g,'')
      .replace(/\scontenteditable="[^"]*"/g,'');
  }
  function cleanHtml(){
    if(EDITING) endEdit();
    var d0=curStore(), f0=d0.frozen||{}, k0, touched=false;
    for(k0 in f0){ if(!Object.prototype.hasOwnProperty.call(f0,k0)) continue;
      var nv=scrubSnap(f0[k0]); if(nv!==f0[k0]){ f0[k0]=nv; touched=true; } }
    if(touched) saveData(d0);
    saveData(curStore());
    return withUiDetached(function(){
      var html=null;
      try{ if(window.PVNotes&&typeof window.PVNotes.buildOutput==='function') html=window.PVNotes.buildOutput(); }catch(e){ html=null; }
      if(!html) html='<!DOCTYPE html>\n'+document.documentElement.outerHTML;
      return html;
    });
  }
  /* pv-notes 自己也会写文件（它记得句柄）。把它的 buildOutput 包一层，
     保证无论从哪条路径保存，编辑器自己的 UI 都不会被烘进新文件。 */
  function patchNotes(){
    var P=window.PVNotes;
    if(!P||P.__paePatched||typeof P.buildOutput!=='function') return;
    var orig=P.buildOutput;
    P.buildOutput=function(){
      var self=this, args=arguments;
      return withUiDetached(function(){ return orig.apply(self,args); });
    };
    P.__paePatched=true;
  }
  function ensurePerm(h){
    if(!h||!h.queryPermission) return Promise.resolve(!!h);
    return h.queryPermission({mode:'readwrite'}).then(function(p){
      if(p==='granted') return true;
      return h.requestPermission({mode:'readwrite'}).then(function(q){ return q==='granted'; });
    }).catch(function(){ return false; });
  }
  var SAVING=false, memHandle=null;
  function fileKey(){ return (location.href||'').split('#')[0]; }
  function currentName(){
    try{ return decodeURIComponent((location.pathname||'').split('/').pop()||'') || 'panel.html'; }
    catch(e){ return 'panel.html'; }
  }
  var dirHandle=null, pickerPatched=false;
  function loadDir(){
    readHandle('dir').then(function(d){
      if(d && typeof d.getFileHandle==='function'){ dirHandle=d; updateAuthBtn(); refreshSaveHint(); }
    });
  }
  function refreshSaveHint(){
    var b=document.querySelector('[data-pae="save"]');
    if(!b) return;
    var t = dirHandle ? ('已授权文件夹「'+dirHandle.name+'」：Ctrl+S 直接覆盖')
          : memHandle ? '已记住这个文件：Ctrl+S 直接覆盖'
          : '第一次保存：选一次这个文件所在的文件夹，之后就不用再选了';
    b.setAttribute('title', t);
  }
  /* 关键：文件句柄必须在 boot 阶段就读进内存。
     否则 Ctrl+S 时要先 await IndexedDB，等回来时浏览器的"用户手势"窗口可能已经过期，
     showSaveFilePicker 会直接抛 SecurityError —— 表现就是"按了 Ctrl+S 但文件没更新"。 */
  var fhChecked=false;
  function loadFileHandle(){
    if(memHandle || fhChecked) return;
    fhChecked=true;                       /* 只读一次，避免轮询里反复打 IndexedDB */
    readHandle('file').then(function(h){
      if(h && typeof h.createWritable==='function'){
        if(!h.name || h.name===currentName()){ memHandle=h; refreshSaveHint(); }
      }
    }).catch(function(){ fhChecked=false; });
  }
  /* 把 showSaveFilePicker 包一层：不管是谁调的（我们的按钮 / Ctrl+S / 批注抽屉的 S），
     都保证「文件名已填好、目录开在原文件夹」，用户不用再自己找。 */
  function patchPicker(){
    if(pickerPatched || !window.showSaveFilePicker) return;
    var orig=window.showSaveFilePicker.bind(window);
    window.showSaveFilePicker=function(opts){
      opts=opts||{};
      if(!opts.suggestedName) opts.suggestedName=currentName();
      /* id：Chrome 会按这个 id 记住上次用过的目录（跨会话），下次自动开在那里 */
      if(!opts.id) opts.id='pvpanel-save';
      if(!opts.startIn){
        if(dirHandle) opts.startIn=dirHandle;
        else if(memHandle) opts.startIn=memHandle;
      }
      return orig(opts);
    };
    if(window.showDirectoryPicker && !window.__paeDirPatched){
      var od=window.showDirectoryPicker.bind(window);
      window.showDirectoryPicker=function(o){
        o=o||{};
        if(!o.id) o.id='pvpanel-dir';
        return od(o);
      };
      window.__paeDirPatched=true;
    }
    pickerPatched=true;
  }
  function notesGet(k){
    if(window.PVNotes&&window.PVNotes._idbGet) return window.PVNotes._idbGet(k).catch(function(){ return null; });
    return paeGet(k);
  }
  /* ---- 自己的一套句柄持久化：不依赖别的模块，避免对方重构后静默失效 ---- */
  var IDB_NAME='pvanyedit', IDB_STORE='h';
  function paeDB(){
    return new Promise(function(res, rej){
      if(!window.indexedDB){ rej(new Error('no idb')); return; }
      var rq=indexedDB.open(IDB_NAME, 1);
      rq.onupgradeneeded=function(){ try{ rq.result.createObjectStore(IDB_STORE); }catch(e){} };
      rq.onsuccess=function(){ res(rq.result); };
      rq.onerror=function(){ rej(rq.error||new Error('idb open fail')); };
      setTimeout(function(){ rej(new Error('idb timeout')); }, 2000);
    });
  }
  function paeGet(k){
    return paeDB().then(function(db){
      return new Promise(function(res){
        try{
          var t=db.transaction(IDB_STORE,'readonly'), q=t.objectStore(IDB_STORE).get(k);
          q.onsuccess=function(){ res(q.result||null); }; q.onerror=function(){ res(null); };
        }catch(e){ res(null); }
      });
    }).catch(function(){ return null; });
  }
  function paePut(k, v){
    return paeDB().then(function(db){
      return new Promise(function(res){
        try{
          var t=db.transaction(IDB_STORE,'readwrite');
          t.objectStore(IDB_STORE).put(v, k);
          t.oncomplete=function(){ res(1); }; t.onerror=function(){ res(0); }; t.onabort=function(){ res(0); };
        }catch(e){ res(0); }
      });
    }).catch(function(){ return 0; });
  }
  function handleKeys(kind){
    var base=(location.href||'').split('#')[0];
    return kind==='dir' ? ['dir::'+base, 'dir::*'] : ['file::'+base, 'file::*'];
  }
  function readHandle(kind){
    var ks=handleKeys(kind);
    return paeGet(ks[0]).then(function(h){
      if(h) return h;
      return paeGet(ks[1]).then(function(h2){
        if(h2) return h2;
        return notesGet(ks[0]).then(function(h3){ return h3 || notesGet(ks[1]); });
      });
    });
  }
  function clearHandle(kind){
    var ks=handleKeys(kind);
    paePut(ks[0], null); paePut(ks[1], null);
    if(window.PVNotes&&window.PVNotes._idbPut){ window.PVNotes._idbPut(ks[0], null); window.PVNotes._idbPut(ks[1], null); }
  }
  function writeHandle(kind, h){
    var ks=handleKeys(kind);
    paePut(ks[0], h); paePut(ks[1], h);
    if(window.PVNotes&&window.PVNotes._idbPut){ window.PVNotes._idbPut(ks[0], h); window.PVNotes._idbPut(ks[1], h); }
  }
  function notesPut(k, v){
    try{ if(window.PVNotes&&window.PVNotes._idbPut) window.PVNotes._idbPut(k, v); }catch(e){}
  }
  function setSaveLabel(txt, ok){
    var b=document.querySelector('[data-pae="save"]');
    if(!b) return;
    b.textContent=txt;
    b.style.background = (ok===false) ? '#C2170A' : '#159788';
    if(txt==='💾 保存') b.textContent = (dirHandle||memHandle) ? '💾 保存 ✓' : '💾 保存';
  }
  function writeWith(h, html){
    var expect = null;
    try{ expect = new Blob([html]).size; }catch(e){}
    return h.createWritable().then(function(w){
      return w.write(html).then(function(){ return w.close(); });
    }).then(function(){
      /* 写完立刻读回来比对大小 —— 防止"提示成功、其实没落盘" */
      if(expect===null || typeof h.getFile!=='function') return true;
      return h.getFile().then(function(f){
        if(f.size===expect) return true;
        throw new Error('写入校验失败（文件 '+f.size+' 字节，应为 '+expect+'）');
      }).catch(function(err){
        if(/校验失败/.test(err && err.message || '')) throw err;
        return true;   /* 读不回来不算失败（有些环境不支持） */
      });
    });
  }
  function saveCurrent(forcePicker){
    if(SAVING){ toast('正在保存…'); return; }
    SAVING=true;
    setSaveLabel('💾 保存中…');
    var html;
    try{ html=cleanHtml(); }
    catch(e){ SAVING=false; setSaveLabel('💾 保存'); toast('生成失败：'+e.message); return; }
    try{ return runSave(html, !!forcePicker); }
    catch(e){ SAVING=false; setSaveLabel('💾 保存'); toast('保存失败：'+((e&&e.message)||'未知原因')); }
  }
  function runSave(html, forcePicker){
    var done=function(){
      SAVING=false; loadDir();
      var t=new Date(), hh=('0'+t.getHours()).slice(-2), mm=('0'+t.getMinutes()).slice(-2);
      setSaveLabel('💾 已保存 '+hh+':'+mm);
      toast(window.__paeSavedTo ? ('已保存到文件夹「'+window.__paeSavedTo+'」') : '已保存到原文件（覆盖）');
      setTimeout(function(){ setSaveLabel('💾 保存'); }, 4000);
    };
    var fail=function(err){
      SAVING=false; setSaveLabel('💾 保存');
      toast('保存失败：'+((err&&err.message)||'未知原因'));
    };
    return fallbackSave(html, done, fail, forcePicker).catch(fail);
  }

  function fallbackSave(html, done, fail, forcePicker){
    done = done || function(){ SAVING=false; };
    fail = fail || function(e){ SAVING=false; setSaveLabel('💾 保存'); toast('保存失败：'+((e&&e.message)||'')); };
    /* 0) 已授权文件夹 → 直接写「同名文件」，零弹窗，且对这个文件夹里所有文件都有效 */
    if(dirHandle && typeof dirHandle.getFileHandle!=='function'){ dirHandle=null; updateAuthBtn(); }
    if(dirHandle){
      return dirHandle.getFileHandle(currentName())
        .then(function(fh){ return ensurePerm(fh).then(function(ok){ return ok?fh:null; }); })
        .then(function(fh){
          if(!fh) throw new Error('文件夹权限已失效，请重新授权一次');
          return writeWith(fh, html);
        })
        .then(function(){
          window.__paeSavedTo = dirHandle ? dirHandle.name : '';
          done();
          return true;
        })
        .catch(function(err){
          var nf = err && (err.name==='NotFoundError' || /not found/i.test(err.message||''));
          var nm = dirHandle ? dirHandle.name : '之前的文件夹';
          dirHandle=null; clearHandle('dir'); updateAuthBtn(); refreshSaveHint();
          if(nf){
            toast('「'+nm+'」里没有「'+currentName()+'」—— 之前授权选错了（存到别的文件夹去了），现在重选');
            return firstTimeAuth(html).then(done).catch(fail);   /* 立刻引导重选 */
          }
          fail(err);
          return false;
        });
    }
    /* 1) 本次会话已拿到的句柄 → 直接写，零弹窗 */
    if(!dirHandle && !memHandle){
      /* 这台机器上的第一次：选一次文件夹 → 立刻覆盖保存 → 以后永久静默。
         弹窗必须"同步"调用（中间不能 await，否则用户手势过期 → SecurityError → 保存失败）。 */
      try{ return firstTimeAuth(html).then(done).catch(fail); }
      catch(e){ fail(e); return Promise.resolve(false); }
    }
    if(memHandle){
      return writeWith(memHandle, html).then(done).catch(function(){
        memHandle=null; return pickAndWrite(html).then(done).catch(fail);
      });
    }
    /* 2) 找之前记住的句柄（pv-notes 的 key / 我们自己的 key）→ 直接写，零弹窗 */
    notesGet(fileKey()).then(function(h){ return h || notesGet('pae_file'); }).then(function(h){
      if(!h || typeof h.createWritable!=='function') return null;
      return ensurePerm(h).then(function(ok){ return ok?h:null; });
    }).then(function(h){
      if(!h) return pickAndWrite(html).then(done).catch(fail);
      memHandle=h;
      return writeWith(h, html).then(done).catch(function(){
        memHandle=null; return pickAndWrite(html).then(done).catch(fail);
      });
    }).catch(fail);
  }
  /* 一次性授权一个文件夹：之后这个文件夹里所有文件都能静默保存，永远不再弹窗 */
  function authFolder(){
    if(!window.showDirectoryPicker){ toast('这个浏览器不支持文件夹授权'); return; }
    window.showDirectoryPicker({id:'pvpanel-dir', mode:'readwrite'}).then(function(d){
      dirHandle=d;
      writeHandle('dir', d);
      updateAuthBtn(); refreshSaveHint(); hideFirstRun();
      toast('已授权文件夹「'+d.name+'」：以后 Ctrl+S 直接保存，不再弹窗');
    }).catch(function(err){
      if(err && err.name==='AbortError') return;
      toast('授权失败：'+((err&&err.message)||''));
    });
  }
  function updateAuthBtn(){
    var b=document.querySelector('[data-pae="auth"]');
    if(b) b.style.display = dirHandle ? 'none' : 'inline-flex';
  }
  /* 首次运行引导：没有句柄时提示"授权一次文件夹"（一次覆盖整个文件夹，对所有文件永久生效） */
  var FR_KEY='pvanyedit::firstrun-hidden';
  function firstRunHidden(){ try{ return localStorage.getItem(FR_KEY)==='1'; }catch(e){ return false; } }
  function hideFirstRun(){
    try{ localStorage.setItem(FR_KEY,'1'); }catch(e){}
    var b=document.getElementById('pae-firstrun');
    if(b&&b.parentNode) b.parentNode.removeChild(b);
  }
  function showFirstRun(){
    if(firstRunHidden()||dirHandle||memHandle||document.getElementById('pae-firstrun')) return;
    var el=document.createElement('div'); el.id='pae-firstrun';
    el.innerHTML='<span>💾 <b>一次性设置</b>：选一次这个 HTML 所在的文件夹，<b>以后所有文件 Ctrl+S 都直接覆盖、不再弹窗</b></span>'+
                 '<button type="button" class="pae-btn" style="background:#E0731A;border-color:#E0731A;color:#fff;font-weight:700" data-pae="fr-go">📁 现在就选（只需一次）</button>'+
                 '<button type="button" class="pae-btn" data-pae="fr-x" title="以后再说">✕</button>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      var g=e.target.closest('[data-pae="fr-go"]');
      if(g){ e.preventDefault(); e.stopPropagation(); authFolder(); return; }
      var x=e.target.closest('[data-pae="fr-x"]');
      if(x){ e.preventDefault(); e.stopPropagation(); hideFirstRun(); }
    }, false);
  }

  /* 把当前这个 HTML 文件直接从资源管理器拖进页面 —— 零弹窗拿到可写句柄 */
  function bindDrop(){
    var hint=null;
    function show(){
      if(!hint){
        hint=document.createElement('div'); hint.className='pae-drop';
        hint.textContent='把当前这个 HTML 文件拖到这里 → 授权后 Ctrl+S 静默保存（不会再弹窗）';
        document.body.appendChild(hint);
      }
      hint.classList.add('show');
    }
    function hide(){ if(hint) hint.classList.remove('show'); }
    document.addEventListener('dragover', function(e){
      if(!e.dataTransfer) return;
      e.preventDefault(); e.dataTransfer.dropEffect='copy'; show();
    }, false);
    document.addEventListener('dragleave', function(e){ if(e.target===document.documentElement) hide(); }, false);
    document.addEventListener('drop', function(e){
      if(!e.dataTransfer) return;
      e.preventDefault(); hide();
      var items=e.dataTransfer.items, it=items&&items[0];
      if(!it||!it.getAsFileSystemHandle){ toast('这个浏览器不支持拖拽授权'); return; }
      it.getAsFileSystemHandle().then(function(h){
        if(!h) return;
        if(h.kind==='directory'){
          dirHandle=h; writeHandle('dir', h); updateAuthBtn(); refreshSaveHint(); hideFirstRun();
          toast('已授权文件夹「'+h.name+'」：以后 Ctrl+S 直接保存，不再弹窗');
          return;
        }
        if(h.name && currentName() && h.name!==currentName()){
          toast('拖入的是「'+h.name+'」，与当前文件「'+currentName()+'」不一致，已忽略');
          return;
        }
        return ensurePerm(h).then(function(ok){
          if(!ok){ toast('授权被拒绝'); return; }
          memHandle=h; writeHandle('file', h); refreshSaveHint(); hideFirstRun();
          toast('已授权「'+h.name+'」：以后 Ctrl+S 直接覆盖，不再弹窗');
        });
      }).catch(function(err){ toast('拖拽授权失败：'+((err&&err.message)||'')); });
    }, false);
  }

  function fallbackDownload(html){
    try{
      var a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([html], {type:'text/html'}));
      a.download=currentName();
      document.body.appendChild(a); a.click();
      setTimeout(function(){ document.body.removeChild(a); }, 500);
      toast('此浏览器不支持原地保存，已下载副本');
    }catch(e){ toast('保存失败：'+e.message); }
  }
  /* 3) 没有句柄时才弹一次「另存为」：默认文件名=当前文件名（可自行改名），默认目录=原文件所在目录 */
  var SB_WARNED = false;
  function showSandboxWarning(){
    if(SB_WARNED || document.getElementById('pae-sandbox')) return;
    SB_WARNED = true;
    var el=document.createElement('div'); el.id='pae-sandbox';
    el.innerHTML='<span>⚠️ <b>这个环境禁止网页保存到原文件</b>（从网盘预览 / 微信 / 内嵌浏览器打开时会发生）。'
               + '想正常保存：关掉它，在<b>资源管理器里右键 → 打开方式 → Chrome</b> 直接打开这个文件。</span>'
               + '<button type="button" class="pae-btn" style="background:#159788;border-color:#159788;color:#fff;font-weight:700" data-pae="sb-dl">⬇ 先下载副本</button>'
               + '<button type="button" class="pae-btn" data-pae="sb-x">✕</button>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      var d=e.target.closest('[data-pae="sb-dl"]');
      if(d){ e.preventDefault(); e.stopPropagation();
        try{ saveCurrent(); }catch(err){} return; }
      var x=e.target.closest('[data-pae="sb-x"]');
      if(x){ e.preventDefault(); e.stopPropagation(); el.style.display='none'; }
    }, false);
  }

  /* 是否处在"弹不出文件框"的环境（沙箱 iframe / 网盘预览 / 微信内置浏览器等） */
  function sandboxedEnv(){
    try{ if(window.top !== window.self) return true; }catch(e){ return true; }   /* 跨域说明在 iframe 里 */
    return false;
  }
  function pickerBlocked(err){
    if(!err) return false;
    var m=(err.message||'')+' '+(err.name||'');
    return /sandbox|not allowed|SecurityError|opaque|user gesture|user activation/i.test(m);
  }

  /* 首次保存：三级降级，永不空手而归
     ① 选一次文件夹（最省事：一次授权 = 整个文件夹永久免弹窗）
     ② 被沙箱拦住 / 用户取消 / 浏览器不支持 → 「另存为」，选中这个 HTML 文件本身
     ③ 连"另存为"都弹不出来（沙箱）→ 直接下载一份改好的副本（不需要任何权限） */
  function firstTimeAuth(html){
    patchPicker();
    if(!window.showDirectoryPicker || sandboxedEnv()) return pickAndWrite(html);

    var p;
    try{ p = window.showDirectoryPicker({id:'pvpanel-dir', mode:'readwrite'}); }
    catch(e){ p = Promise.reject(e); }

    return Promise.resolve(p).then(function(d){
      /* 校验：这个文件夹里必须真的有当前这个文件，否则就是选错了 */
      return d.getFileHandle(currentName()).then(function(fh){
        dirHandle=d; writeHandle('dir', d);
        updateAuthBtn(); refreshSaveHint(); hideFirstRun();
        return ensurePerm(fh).then(function(ok){ return ok?fh:null; }).then(function(f){
          if(!f) throw new Error('文件夹权限不足，请重新授权');
          return writeWith(f, html);
        }).then(function(){
          toast('已授权文件夹「'+d.name+'」：以后 Ctrl+S 直接覆盖，永不再弹窗');
          window.__paeSavedTo = d.name;
          return true;
        });
      }).catch(function(err){
        if(err && err.name==='NotFoundError'){
          dirHandle=null; clearHandle('dir');
          throw new Error('你选的文件夹里没有「'+currentName()+'」—— 请再按一次 Ctrl+S，'
                        + '选这个 HTML 文件本身所在的文件夹（不是"下载"）');
        }
        throw err;
      });
    }).catch(function(err){
      var e = err || {};
      if(e.name==='AbortError'){
        toast('已取消。改用「另存为」：选中这个 HTML 文件本身即可（之后就不用再选了）');
        return pickAndWrite(html);
      }
      if(e.name==='NotFoundError' || /没有「/.test(e.message||'')){
        throw e;                                   /* 选错文件夹：明确报错，不静默 */
      }
      /* 被沙箱拦 / 权限被拒 / 其它异常 → 一律降级到"另存为" */
      if(pickerBlocked(e)) showSandboxWarning();
      toast('这个环境不允许"选文件夹"，改用「另存为」（选中这个文件本身即可）');
      return pickAndWrite(html);
    });
  }

  function pickAndWrite(html){
    if(!window.showSaveFilePicker){
      fallbackDownload(html);
      return Promise.resolve(false);
    }
    patchPicker();
    /* 同步构造并在同一个用户手势里调用 —— 不要在前面 await 任何东西 */
    var opts={ suggestedName: currentName(), id:'pvpanel-save' };
    if(dirHandle) opts.startIn=dirHandle;        /* 已授权文件夹 → 直接开在那里 */
    else if(memHandle) opts.startIn=memHandle;   /* 存过同一文件 → 开在该文件所在目录 */
    var p;
    try{
      toast('首次需要授权一次：选中这个 HTML 文件本身，按回车即可（之后就不用再选了）');
      p=window.showSaveFilePicker(opts);
    }catch(e){
      if(pickerBlocked(e)){
        /* 连"另存为"都弹不出来（沙箱环境）→ 兜底：下载一份改好的副本，至少不丢改动 */
        showSandboxWarning();
        toast('当前环境禁止弹文件框 —— 已改为下载一份改好的副本（改完发回即可）');
        fallbackDownload(html);
        return Promise.resolve(true);
      }
      throw e;
    }
    return p.then(function(fh){
      memHandle=fh;
      writeHandle('file', fh);
      if(fh.name) notesPut('pae_lastname', fh.name);
      refreshSaveHint();
      return writeWith(fh, html);
    }).then(function(){ return true; }).catch(function(err){
      if(err && err.name==='AbortError'){ toast('已取消保存（再按一次 Ctrl+S，或点「💾 保存」）'); return false; }
      if(pickerBlocked(err)){
        toast('当前环境禁止弹文件框 —— 已改为下载一份改好的副本');
        fallbackDownload(html);
        return true;
      }
      throw err;
    });
  }
  function boot(){    applyFrozen(); applyStyles(); applyHidden(); buildUI();
    patchNotes(); patchPicker(); loadDir(); bindDrop();
    var tries=0, iv=setInterval(function(){
      patchNotes(); patchPicker();
      if(!dirHandle) loadDir();
      loadFileHandle();
      updateAuthBtn(); refreshSaveHint();
      if(++tries>20) clearInterval(iv);
    }, 300);
    setTimeout(function(){ applyFrozen(); applyStyles(); applyHidden(); },400);
    setTimeout(function(){ applyStyles(); },1200);
    setTimeout(function(){ showFirstRun(); refreshSaveHint(); }, 1800);
    setTimeout(function(){ if(sandboxedEnv()) showSandboxWarning(); }, 1200);
    window.PVAnyEdit={
      on:function(){ setOn(true); }, off:function(){ setOn(false); }, undo:undo, save:saveCurrent,
      apply:function(){ applyFrozen(); applyStyles(); applyHidden(); },
      clear:function(){ if(window.confirm('把「任意编辑」的所有改动（删除 / 移动 / 样式 / 图表）全部还原？')){ saveData({}); location.reload(); } },
      __dump:function(){ var b=document.querySelector('[data-pae="bar"]'); return JSON.stringify({barChildren:b?b.children.length:-1,on:ON,sel:SEL?SEL.tagName:null,svg:SEL?isSVG(SEL):null}); }
    };
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,false); else boot();
})();
