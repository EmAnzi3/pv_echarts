const state = { data:null, metric:'MWp', geoLoaded:false };
const fmt = new Intl.NumberFormat('it-IT');
const fmt1 = new Intl.NumberFormat('it-IT',{maximumFractionDigits:1});
const charts = {};

const PROVINCE_ALIASES = {
  "Reggio di Calabria":"Reggio Calabria",
  "Monza e Brianza":"Monza e della Brianza",
  "Forli-Cesena":"Forlì-Cesena",
  "Forlì Cesena":"Forlì-Cesena",
  "Bolzano":"Bolzano/Bozen",
  "Bolzano-Bozen":"Bolzano/Bozen",
  "Valle d'Aosta":"Valle d'Aosta/Vallée d'Aoste",
  "Aosta":"Valle d'Aosta/Vallée d'Aoste",
  "Massa Carrara":"Massa-Carrara",
  "Pesaro Urbino":"Pesaro e Urbino",
  "Reggio Emilia":"Reggio nell'Emilia"
};
function normProvince(v){
  if(!v) return '';
  let s = String(v).trim().replace(/\s+/g,' ');
  return PROVINCE_ALIASES[s] || s;
}
function el(id){return document.getElementById(id)}
function resizeAll(){Object.values(charts).forEach(c=>c && c.resize())}
window.addEventListener('resize', resizeAll);

async function fetchJson(url){
  const r = await fetch(url, {cache:'no-cache'});
  if(!r.ok) throw new Error(`${url}: ${r.status}`);
  return await r.json();
}
async function loadGeo(){
  const urls = [
    'data/limits_IT_provinces.geojson',
    'https://cdn.jsdelivr.net/gh/openpolis/geojson-italy@master/geojson/limits_IT_provinces.geojson'
  ];
  let last;
  for(const url of urls){
    try{
      const geo = await fetchJson(url);
      geo.features.forEach(f=>{
        const p = f.properties || {};
        const name = p.prov_name || p.provincia || p.name || p.NOME_PRO || p.DEN_UTS || p.prov_istat_code_name || '';
        f.properties.name = normProvince(name);
      });
      echarts.registerMap('italy_provinces', geo);
      state.geoLoaded = true;
      return;
    }catch(e){ last=e; }
  }
  throw last || new Error('GeoJSON province non caricato');
}

function drawKpis(){
  const s = state.data.summary;
  const items = [
    ['Progetti mappati', fmt.format(s.projects), 'cantieri inclusi nella correlazione'],
    ['Potenza totale', `${fmt1.format(s.mwp)} MWp`, 'somma dei progetti mappati'],
    ['Stessa filiale', fmt.format(s.same_branch), 'cliente e cantiere coincidono'],
    ['Filiale diversa', fmt.format(s.different_branch), 'serve coordinamento interfiliale'],
    ['Quota interfiliale', `${fmt1.format(s.different_pct)}%`, 'filiale cliente ≠ filiale cantiere']
  ];
  el('kpis').innerHTML = items.map(i=>`<div class="kpi"><span>${i[0]}</span><strong>${i[1]}</strong><small>${i[2]}</small></div>`).join('');
}
function initChart(id){ charts[id] = echarts.init(el(id)); return charts[id]; }
function setChart(id,opt){ (charts[id]||initChart(id)).setOption(opt,true); }
function palette(){ return ['#0f4c81','#2374ab','#5fa8d3','#8ecae6','#6a4c93','#7c3aed','#ffb703','#fb8500','#d62828','#2a9d8f','#577590','#bc6c25','#a7c957','#c9184a']; }

function branchColorMap(metric){
  const totals = new Map();
  state.data.flows.forEach(f=>{
    const v = +f[metric] || 0;
    const fc = f['Filiale cliente'];
    const fp = f['Filiale cantiere'];
    totals.set(fc, (totals.get(fc) || 0) + v);
    totals.set(fp, (totals.get(fp) || 0) + v);
  });
  const ordered = [...totals.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0], 'it')).map(x=>x[0]);
  const colors = {};
  ordered.forEach((name, idx)=>{ colors[name] = palette()[idx % palette().length]; });
  return colors;
}

function cleanSankeyName(name){
  return String(name || '').replace(/^CLIENTE\|/, '').replace(/^PROGETTO\|/, '');
}

function drawSankey(){
  const metric = state.metric;
  const flows = state.data.flows
    .map(f=>({
      cliente: f['Filiale cliente'],
      progetto: f['Filiale cantiere'],
      sourceId: 'CLIENTE|' + f['Filiale cliente'],
      targetId: 'PROGETTO|' + f['Filiale cantiere'],
      value: +(f[metric] || 0),
      projects: +(f['N. progetti'] || 0),
      mwp: +(f['MWp'] || 0)
    }))
    .filter(f=>f.cliente && f.progetto && f.value > 0);

  const sourceTotals = new Map();
  const targetTotals = new Map();
  flows.forEach(f=>{
    sourceTotals.set(f.cliente, (sourceTotals.get(f.cliente) || 0) + f.value);
    targetTotals.set(f.progetto, (targetTotals.get(f.progetto) || 0) + f.value);
  });

  const sourceOrder = [...sourceTotals.entries()]
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0], 'it'))
    .map(x=>x[0]);
  const targetOrder = [...targetTotals.entries()]
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0], 'it'))
    .map(x=>x[0]);

  const sIndex = Object.fromEntries(sourceOrder.map((n,i)=>[n,i]));
  const tIndex = Object.fromEntries(targetOrder.map((n,i)=>[n,i]));
  const colorMap = branchColorMap(metric);
  const leftPad = Math.max(80, Math.min(220, Math.max(...sourceOrder.map(n=>n.length), 8) * 8));
  const rightPad = Math.max(110, Math.min(260, Math.max(...targetOrder.map(n=>n.length), 8) * 8));

  const nodes = [
    ...sourceOrder.map(name=>({
      name:'CLIENTE|' + name,
      depth:0,
      value:sourceTotals.get(name),
      itemStyle:{color:colorMap[name]}
    })),
    ...targetOrder.map(name=>({
      name:'PROGETTO|' + name,
      depth:1,
      value:targetTotals.get(name),
      itemStyle:{color:colorMap[name]}
    }))
  ];

  const links = flows
    .sort((a,b)=> (sIndex[a.cliente]-sIndex[b.cliente]) || (tIndex[a.progetto]-tIndex[b.progetto]) || (b.value-a.value))
    .map(f=>({
      source:f.sourceId,
      target:f.targetId,
      value:f.value,
      sourceLabel:f.cliente,
      targetLabel:f.progetto,
      projects:f.projects,
      mwp:f.mwp,
      lineStyle:{color:colorMap[f.cliente], opacity:.32}
    }));

  setChart('sankey',{
    animationDuration: 500,
    animationDurationUpdate: 500,
    tooltip:{
      trigger:'item',
      formatter:p=>{
        if(p.dataType==='edge') return `<b>${p.data.sourceLabel}</b> → <b>${p.data.targetLabel}</b><br>${fmt1.format(p.data.mwp)} MWp<br>${fmt.format(p.data.projects)} progetti`;
        const clean = cleanSankeyName(p.name);
        const isSource = String(p.name).startsWith('CLIENTE|');
        const total = isSource ? sourceTotals.get(clean) : targetTotals.get(clean);
        const label = isSource ? 'Clienti' : 'Progetti';
        const unit = metric === 'MWp' ? ' MWp' : ' progetti';
        return `<b>${clean}</b><br>${label}: ${fmt1.format(total || 0)}${unit}`;
      }
    },
    graphic:[
      {type:'text', left: leftPad - 56, top: 10, style:{text:'Clienti', fill:'#334155', font:'600 13px sans-serif'}},
      {type:'text', right: rightPad - 56, top: 10, style:{text:'Progetti', fill:'#334155', font:'600 13px sans-serif', align:'right'}}
    ],
    series:[{
      type:'sankey',
      top: 34, left: leftPad, right: rightPad, bottom: 8,
      data:nodes,
      links,
      emphasis:{focus:'adjacency'},
      nodeAlign:'justify',
      nodeWidth:16,
      nodeGap:10,
      draggable:false,
      layoutIterations:0,
      lineStyle:{color:'source',curveness:.5,opacity:.32},
      label:{
        fontSize:12,
        color:'#172033',
        formatter:p=>cleanSankeyName(p.name)
      },
      levels:[
        {depth:0, itemStyle:{borderWidth:0}, lineStyle:{color:'source',opacity:.32}, label:{position:'right'}},
        {depth:1, itemStyle:{borderWidth:0}, label:{position:'left'}}
      ]
    }]
  });
}

function barOption(rows, label, value, unit=''){
  const r = [...rows].slice(0,10).reverse();
  return {grid:{left:132,right:22,top:18,bottom:38},tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},xAxis:{type:'value',splitLine:{lineStyle:{color:'#e5e7eb'}}},yAxis:{type:'category',data:r.map(x=>x[label]),axisLabel:{fontSize:11}},series:[{type:'bar',data:r.map(x=>+x[value]||0),itemStyle:{color:'#0f4c81',borderRadius:[0,8,8,0]},label:{show:true,position:'right',formatter:p=>`${fmt1.format(p.value)}${unit}`}}]};
}
function drawBars(){
  setChart('barCantiere', barOption(state.data.top_cantiere,'Filiale cantiere','N. progetti'));
  setChart('barCliente', barOption(state.data.top_cliente,'Filiale cliente','N. progetti'));
}
function mapDataCantieri(){ return state.data.province_cantieri.map(r=>({name:normProvince(r['Provincia cantiere']), value:+r.MWp||0, projects:r['N. progetti'], clients:r['Clienti unici'], mwp:r.MWp, region:r['Regione cantiere']})); }
function mapDataClienti(key='Clienti'){ return state.data.province_clienti.map(r=>({name:normProvince(r.Provincia), value:+r[key]||0, clients:r.Clienti, projects:r.Progetti, mwp:r.MWp})); }
function drawMap(id, data, title, subtitle, valueLabel){
  const allValues = data.map(d=>Number.isFinite(+d.value)? +d.value : 0);
  const positiveValues = allValues.filter(v=>v>0);
  const min = Math.min(...allValues, 0);
  const max = Math.max(...positiveValues, 1);
  setChart(id,{
    tooltip:{trigger:'item',formatter:p=>{
      const d=p.data; if(!d) return `<b>${p.name}</b><br>Nessun dato`;
      const value = Number.isFinite(+d.value) ? +d.value : 0;
      const mwp = Number.isFinite(+d.mwp) ? +d.mwp : 0;
      const projects = Number.isFinite(+d.projects) ? +d.projects : 0;
      const clients = Number.isFinite(+d.clients) ? +d.clients : 0;
      return `<b>${p.name}</b><br>${valueLabel}: <b>${fmt1.format(value)}</b><br>MWp: ${fmt1.format(mwp)}<br>Progetti: ${fmt.format(projects)}<br>Clienti: ${fmt.format(clients)}`;
    }},
    visualMap:{
      min:0,max,orient:'horizontal',left:'center',bottom:8,itemWidth:8,itemHeight:170,text:['Alto','Basso'],textGap:8,
      textStyle:{fontSize:10,color:'#475569'},
      inRange:{color:['#f5f7fb','#fee8c8','#fdbb84','#e34a33','#7f0000']}
    },
    series:[{name:title,type:'map',map:'italy_provinces',roam:true,layoutCenter:['50%','48%'],layoutSize:'90%',data,emphasis:{label:{show:true}},select:{disabled:true},itemStyle:{borderColor:'#9aa4b2',borderWidth:.7,areaColor:'#f6f8fb'}}]
  });
}
async function drawMaps(){
  if(!state.geoLoaded){
    ['mapCantieri','mapClientiMWp'].forEach(id=>el(id).innerHTML='<div class="error">GeoJSON province non disponibile. Controlla la connessione o scarica il file in data/limits_IT_provinces.geojson.</div>'); return;
  }
  drawMap('mapCantieri', mapDataCantieri(), 'Progetti FV per provincia (MWp)', '', 'MWp progetti');
  drawMap('mapClientiMWp', mapDataClienti('MWp'), 'Clienti per provincia (MWp)', '', 'MWp collegati');
}
function drawHeatmap(){
  const rows=[...new Set(state.data.heatmap_filiali.map(r=>r['Filiale cliente']))];
  const cols=[...new Set(state.data.heatmap_filiali.map(r=>r['Filiale cantiere']))];
  const data=state.data.heatmap_filiali.map(r=>[cols.indexOf(r['Filiale cantiere']),rows.indexOf(r['Filiale cliente']),+(r.MWp||0)]);
  const max=Math.max(...data.map(x=>x[2]),1);
  setChart('heatmap',{tooltip:{position:'top',formatter:p=>`${rows[p.data[1]]} → ${cols[p.data[0]]}<br><b>${fmt1.format(p.data[2])} MWp</b>`},grid:{left:130,right:30,top:40,bottom:90},xAxis:{type:'category',data:cols,axisLabel:{rotate:45,fontSize:10}},yAxis:{type:'category',data:rows,axisLabel:{fontSize:10}},visualMap:{min:0,max,calculable:true,orient:'horizontal',left:'center',bottom:0,inRange:{color:['#f7fbff','#6baed6','#08306b']}},series:[{type:'heatmap',data,label:{show:false},emphasis:{itemStyle:{shadowBlur:10,shadowColor:'rgba(0,0,0,.25)'}}}]});
}
function makeTreeGeo(){
  const root={name:'Cantieri FV', children:[]};
  const find=(arr,name)=>{let x=arr.find(i=>i.name===name); if(!x){x={name,children:[]};arr.push(x)} return x};
  state.data.treemap_geografica.forEach(r=>{
    const reg=find(root.children,r['Regione cantiere']||'ND');
    const prov=find(reg.children,r['Provincia cantiere']||'ND');
    const com=find(prov.children,r['Comune cantiere']||'ND');
    const cli=find(com.children,r['Cliente progetto']||'ND');
    cli.children.push({name:r.Progetto||'Progetto', value:Math.max(+r['Potenza MWp']||0,0.01)});
  });
  return root.children;
}
function makeTreeBranches(){
  const root={name:'Filiali', children:[]};
  const find=(arr,name)=>{let x=arr.find(i=>i.name===name); if(!x){x={name,children:[]};arr.push(x)} return x};
  state.data.treemap_filiali.forEach(r=>{
    const fc=find(root.children,r['Filiale cliente']||'ND');
    const ft=find(fc.children,r['Filiale cantiere']||'ND');
    const cli=find(ft.children,r['Cliente progetto']||'ND');
    cli.children.push({name:r.Progetto||'Progetto', value:Math.max(+r['Potenza MWp']||0,0.01)});
  });
  return root.children;
}
function drawTreemaps(){
  const common={type:'treemap',leafDepth:2,upperLabel:{show:true,height:24},label:{show:true,formatter:'{b}'},breadcrumb:{show:true},roam:false,itemStyle:{borderColor:'#fff',borderWidth:2,gapWidth:2}};
  setChart('treemapGeo',{tooltip:{formatter:p=>`${p.name}<br>${fmt1.format(p.value||0)} MWp`},series:[{...common,name:'Geografia',data:makeTreeGeo()}]});
  setChart('treemapBranches',{tooltip:{formatter:p=>`${p.name}<br>${fmt1.format(p.value||0)} MWp`},series:[{...common,name:'Filiali',data:makeTreeBranches()}]});
}
function renderTable(id,rows,cols){
  el(id).innerHTML='<thead><tr>'+cols.map(c=>`<th>${c[0]}</th>`).join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cols.map(c=>{let v=r[c[1]]??'';let cls=typeof v==='number'?'num':''; if(c[1]==='Esito') v=`<span class="pill ${v==='FILIALE DIVERSA'?'diff':'same'}">${v}</span>`; return `<td class="${cls}">${v}</td>`}).join('')+'</tr>').join('')+'</tbody>';
}
function drawTables(){
  const priority=state.data.details.filter(r=>r.Esito==='FILIALE DIVERSA').sort((a,b)=>b.MWp-a.MWp).slice(0,25);
  renderTable('priorityTable',priority,[['Cliente','Cliente'],['Progetto','Progetto'],['Filiale cliente','Filiale cliente'],['Filiale cantiere','Filiale cantiere'],['Provincia','Provincia cantiere'],['MWp','MWp']]);
  drawDetailTable();
}
function drawDetailTable(){
  const q=(el('search').value||'').toLowerCase(); const e=el('esito').value;
  const rows=state.data.details.filter(r=>(!e||r.Esito===e)&&JSON.stringify(r).toLowerCase().includes(q)).slice(0,500);
  renderTable('detailsTable',rows,[['Cliente','Cliente'],['Progetto','Progetto'],['Comune cantiere','Comune cantiere'],['Prov. cantiere','Provincia cantiere'],['Filiale cantiere','Filiale cantiere'],['Filiale cliente','Filiale cliente'],['Sede cliente','Comune sede'],['MWp','MWp'],['Esito','Esito']]);
}
function bind(){
  el('metricMWp').onclick=()=>{state.metric='MWp'; el('metricMWp').classList.add('active'); el('metricProjects').classList.remove('active'); drawSankey();};
  el('metricProjects').onclick=()=>{state.metric='N. progetti'; el('metricProjects').classList.add('active'); el('metricMWp').classList.remove('active'); drawSankey();};
  el('search').oninput=drawDetailTable; el('esito').onchange=drawDetailTable;
}
async function boot(){
  try{
    state.data = await fetchJson('data/dashboard.json');
    drawKpis(); bind(); drawSankey(); drawBars(); drawHeatmap(); drawTreemaps(); drawTables();
    try{ await loadGeo(); await drawMaps(); }catch(e){ console.warn(e); await drawMaps(); }
    setTimeout(resizeAll,500);
  }catch(e){
    document.body.innerHTML=`<div class="wrap"><div class="error"><b>Errore caricamento dashboard.</b><br>${e.message}</div></div>`;
  }
}
boot();
