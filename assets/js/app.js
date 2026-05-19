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
function resizeAll(){Object.values(charts).forEach(c=>c && c.resize()); if(state.data) drawTreemaps();}
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

function interpolateHex(c1, c2, t){
  const a = c1.match(/\w\w/g).map(x=>parseInt(x,16));
  const b = c2.match(/\w\w/g).map(x=>parseInt(x,16));
  const r = a.map((v,i)=>Math.round(v + (b[i]-v)*Math.max(0, Math.min(1, t))));
  return '#' + r.map(v=>v.toString(16).padStart(2,'0')).join('');
}
function valueColor(v, max){
  const t = max > 0 ? (+v || 0) / max : 0;
  return interpolateHex('8ecae6', '0f4c81', t);
}
function barOption(rows, label, value, unit=''){
  const top = [...rows].slice(0,10);
  const max = Math.max(...top.map(x=>+x[value]||0), 1);
  const r = top.reverse();
  return {
    grid:{left:132,right:34,top:18,bottom:38},
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:params=>{
      const p = params[0];
      return `<b>${p.name}</b><br>${fmt1.format(p.value)}${unit}`;
    }},
    xAxis:{type:'value',splitLine:{lineStyle:{color:'#e5e7eb'}}},
    yAxis:{type:'category',data:r.map(x=>x[label]),axisLabel:{fontSize:11}},
    series:[{
      type:'bar',
      data:r.map(x=>+x[value]||0),
      itemStyle:{
        borderRadius:[0,8,8,0],
        color:p=>valueColor(p.value, max)
      },
      label:{show:true,position:'right',formatter:p=>`${fmt1.format(p.value)}${unit}`}
    }]
  };
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
      min,max,orient:'horizontal',left:'center',bottom:8,itemWidth:8,itemHeight:170,
      text:[`${fmt1.format(max)}`, `${fmt1.format(min)}`],textGap:8,
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
  const lookup = new Map();
  state.data.heatmap_filiali.forEach(r=>{
    lookup.set(`${r['Filiale cliente']}|${r['Filiale cantiere']}`, +(r.MWp || 0));
  });
  const rawData=[];
  rows.forEach((row, y)=>{
    cols.forEach((col, x)=>{
      rawData.push([x, y, lookup.get(`${row}|${col}`) || 0]);
    });
  });
  const max=Math.max(...rawData.map(x=>x[2]),1);
  const scaledMax = Math.sqrt(max);
  const data = rawData.map(d => [d[0], d[1], Math.sqrt(d[2]), d[2]]);
  setChart('heatmap',{
    tooltip:{position:'top',formatter:p=>`${rows[p.data[1]]} → ${cols[p.data[0]]}<br><b>${fmt1.format(p.data[3])} MWp</b>`},
    graphic:[
      {type:'text', left: 22, top: 18, style:{text:'Filiale cliente', fill:'#334155', font:'600 13px sans-serif'}},
      {type:'text', left: 'center', bottom: 18, style:{text:'Filiale progetti', fill:'#334155', font:'600 13px sans-serif', textAlign:'center'}}
    ],
    grid:{left:130,right:34,top:52,bottom:116},
    xAxis:{
      type:'category',data:cols,
      name:'',
      axisLabel:{rotate:45,fontSize:10, margin: 12}
    },
    yAxis:{
      type:'category',data:rows,
      name:'',
      axisLabel:{fontSize:10}
    },
    visualMap:{
      min:0,max:scaledMax,dimension:2,calculable:false,orient:'horizontal',left:'72%',bottom:2,itemWidth:8,itemHeight:220,
      text:[`${fmt1.format(max)}`, '0'],textGap:8,textStyle:{fontSize:10,color:'#475569'},
      inRange:{color:['#ffffff','#e2f2e2','#b9dfbb','#6dbc74','#1f7a3f']}
    },
    series:[{type:'heatmap',data,label:{show:false},emphasis:{itemStyle:{shadowBlur:10,shadowColor:'rgba(0,0,0,.25)'}},itemStyle:{borderWidth:0.4,borderColor:'#f2f5f2'}}]
  });
}

function treeValue(node){
  if(node.children && node.children.length){
    node.children.forEach(treeValue);
    node.value = node.children.reduce((sum, child) => sum + (+child.value || 0), 0);
    node.children.sort((a,b)=>(b.value||0)-(a.value||0) || String(a.name).localeCompare(String(b.name), 'it'));
  } else {
    node.value = Math.max(+node.value || 0, 0.01);
  }
  return node;
}
function buildGroupedTree(rows, keys){
  if(!keys.length) return [];
  const [key, ...rest] = keys;
  const groups = new Map();
  rows.forEach(r => {
    const name = r[key] || 'ND';
    if(!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  });
  const nodes = [...groups.entries()].map(([name, items]) => {
    if(rest.length === 0){
      return { name, value: items.reduce((sum, row) => sum + Math.max(+row['Potenza MWp'] || 0, 0), 0) || 0.01 };
    }
    return treeValue({ name, children: buildGroupedTree(items, rest) });
  });
  nodes.sort((a,b)=>(b.value||0)-(a.value||0) || String(a.name).localeCompare(String(b.name), 'it'));
  return nodes;
}
function fillSelect(id, items, allLabel){
  const select = el(id);
  if(!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${allLabel}</option>` + items.map(name => `<option value="${name}">${name}</option>`).join('');
  if(items.includes(current)) select.value = current;
}
function populateTreemapFilters(){
  const regions = [...new Set(state.data.treemap_geografica.map(r => r['Regione cantiere']).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
  const branches = [...new Set(state.data.treemap_filiali.map(r => r['Filiale cliente']).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
  fillSelect('geoRegionFilter', regions, 'Tutte le regioni');
  fillSelect('branchFilter', branches, 'Tutte le filiali');
}
function makeTreeGeo(selectedRegion=''){
  if(!selectedRegion){
    return buildGroupedTree(state.data.treemap_geografica, ['Regione cantiere','Provincia cantiere']);
  }
  const rows = state.data.treemap_geografica.filter(r => (r['Regione cantiere'] || 'ND') === selectedRegion);
  return buildGroupedTree(rows, ['Provincia cantiere','Comune cantiere','Cliente progetto','Progetto']);
}
function makeTreeBranches(selectedBranch=''){
  if(!selectedBranch){
    return buildGroupedTree(state.data.treemap_filiali, ['Filiale cliente','Filiale cantiere']);
  }
  const rows = state.data.treemap_filiali.filter(r => (r['Filiale cliente'] || 'ND') === selectedBranch);
  return buildGroupedTree(rows, ['Filiale cantiere','Cliente progetto','Progetto']);
}
function treemapTopColor(name, idx){
  const colors = ['#2F6BFF','#9B51E0','#EB4D8A','#27AE60','#F2C94C','#2D9CDB','#6C5CE7','#F2994A','#00A3A3','#7F8C8D','#56CCF2','#BB6BD9'];
  return colors[idx % colors.length];
}
function softenColor(hex, depth){
  const c = d3.color(hex) || d3.color('#5B8FF9');
  if(depth <= 1) return c.formatHex();
  return c.brighter(depth === 2 ? 0.55 : 0.95).formatHex();
}
function textColorFor(hex){
  const c = d3.color(hex);
  if(!c) return '#fff';
  const yiq = ((c.r*299)+(c.g*587)+(c.b*114))/1000;
  return yiq >= 150 ? '#172033' : '#fff';
}
function ellipsize(text, maxChars){
  const s = String(text || '');
  if(s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars-1)) + '…';
}
function drawD3Treemap(containerId, nodes){
  const container = el(containerId);
  if(!container || typeof d3 === 'undefined') return;
  container.innerHTML = '';
  const width = Math.max(container.clientWidth || 600, 320);
  const height = Math.max(container.clientHeight || 430, 300);
  const root = d3.hierarchy({name:'root', children:nodes}).sum(d => d.value || 0).sort((a,b)=>b.value-a.value);
  d3.treemap()
    .size([width, height])
    .round(true)
    .paddingOuter(0)
    .paddingTop(d => d.depth === 1 ? 26 : 2)
    .paddingInner(d => d.depth === 0 ? 4 : 2)
    .tile(d3.treemapSquarify.ratio(1.15))(root);

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('role', 'img');

  const topNodes = root.children || [];
  const colorMap = new Map(topNodes.map((d,i)=>[d.data.name, treemapTopColor(d.data.name, i)]));
  const topAncestor = d => d.ancestors().find(a => a.depth === 1) || d;

  const cells = svg.selectAll('g.cell')
    .data(root.descendants().filter(d => d.depth > 0))
    .join('g')
    .attr('class', d => `cell depth-${d.depth}`)
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  cells.append('rect')
    .attr('width', d => Math.max(0, d.x1-d.x0))
    .attr('height', d => Math.max(0, d.y1-d.y0))
    .attr('rx', d => d.depth === 1 ? 0 : 1)
    .attr('fill', d => softenColor(colorMap.get(topAncestor(d).data.name), d.depth))
    .attr('stroke', '#ffffff')
    .attr('stroke-width', d => d.depth === 1 ? 3 : 1)
    .append('title')
    .text(d => `${d.ancestors().slice(1).map(a=>a.data.name).join(' → ')}\n${fmt1.format(d.value || 0)} MWp`);

  const headers = cells.filter(d => d.depth === 1 && (d.x1-d.x0) > 48 && (d.y1-d.y0) > 34);
  headers.append('text')
    .attr('x', 7)
    .attr('y', 17)
    .attr('fill', d => textColorFor(softenColor(colorMap.get(d.data.name), d.depth)))
    .attr('font-size', 12)
    .attr('font-weight', 800)
    .text(d => ellipsize(String(d.data.name).toUpperCase(), Math.max(4, Math.floor((d.x1-d.x0)/8))));

  const labels = cells.filter(d => d.depth > 1 && (d.x1-d.x0) > 46 && (d.y1-d.y0) > 24);
  labels.append('text')
    .attr('x', 7)
    .attr('y', 15)
    .attr('fill', d => textColorFor(softenColor(colorMap.get(topAncestor(d).data.name), d.depth)))
    .attr('font-size', 12)
    .attr('font-weight', 600)
    .text(d => ellipsize(d.data.name, Math.max(4, Math.floor((d.x1-d.x0)/8))));
}
function drawTreemaps(){
  const region = el('geoRegionFilter')?.value || '';
  const branch = el('branchFilter')?.value || '';
  drawD3Treemap('treemapGeo', makeTreeGeo(region));
  drawD3Treemap('treemapBranches', makeTreeBranches(branch));
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
  el('search').oninput=drawDetailTable; el('esito').onchange=drawDetailTable; if(el('geoRegionFilter')) el('geoRegionFilter').onchange=drawTreemaps; if(el('branchFilter')) el('branchFilter').onchange=drawTreemaps;
}
async function boot(){
  try{
    state.data = await fetchJson('data/dashboard.json');
    populateTreemapFilters();
    drawKpis(); bind(); drawSankey(); drawBars(); drawHeatmap(); drawTreemaps(); drawTables();
    try{ await loadGeo(); await drawMaps(); }catch(e){ console.warn(e); await drawMaps(); }
    setTimeout(resizeAll,500);
  }catch(e){
    document.body.innerHTML=`<div class="wrap"><div class="error"><b>Errore caricamento dashboard.</b><br>${e.message}</div></div>`;
  }
}
boot();
