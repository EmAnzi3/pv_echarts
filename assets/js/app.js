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
function palette(){ return ['#0f4c81','#2374ab','#5fa8d3','#8ecae6','#ffb703','#fb8500','#d62828','#6a4c93']; }

function drawSankey(){
  const flows = [...state.data.flows].sort((a,b)=>b[state.metric]-a[state.metric]).slice(0,35);
  const nodes = new Map();
  flows.forEach(f=>{ nodes.set('C|'+f['Filiale cliente'], {name:'Cliente: '+f['Filiale cliente']}); nodes.set('T|'+f['Filiale cantiere'], {name:'Cantiere: '+f['Filiale cantiere']}); });
  const links = flows.map(f=>({
    source:'Cliente: '+f['Filiale cliente'], target:'Cantiere: '+f['Filiale cantiere'], value:+f[state.metric]||0,
    projects:f['N. progetti'], mwp:f['MWp']
  }));
  setChart('sankey',{
    color: palette(), tooltip:{trigger:'item',formatter:p=>{
      if(p.dataType==='edge') return `<b>${p.data.source.replace('Cliente: ','')}</b> → <b>${p.data.target.replace('Cantiere: ','')}</b><br>${fmt1.format(p.data.mwp)} MWp<br>${fmt.format(p.data.projects)} progetti`;
      return p.name;
    }},
    series:[{type:'sankey',data:[...nodes.values()],links,emphasis:{focus:'adjacency'},nodeAlign:'justify',nodeWidth:16,nodeGap:12,lineStyle:{color:'gradient',curveness:.5,opacity:.35},label:{fontSize:12,color:'#172033'}}]
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
  const values = data.map(d=>d.value).filter(v=>v>0); const max = Math.max(...values, 1);
  setChart(id,{
    tooltip:{trigger:'item',formatter:p=>{
      const d=p.data; if(!d) return `<b>${p.name}</b><br>Nessun dato`;
      return `<b>${p.name}</b><br>${valueLabel}: <b>${fmt1.format(d.value)}</b><br>MWp: ${fmt1.format(d.mwp||0)}<br>Progetti: ${fmt.format(d.projects||0)}<br>Clienti: ${fmt.format(d.clients||0)}`;
    }},
    visualMap:{min:0,max,orient:'horizontal',left:16,bottom:8,itemWidth:160,text:['Alto','Basso'],inRange:{color:['#f5f7fb','#fee8c8','#fdbb84','#e34a33','#7f0000']}},
    series:[{name:title,type:'map',map:'italy_provinces',roam:true,layoutCenter:['50%','52%'],layoutSize:'100%',data,emphasis:{label:{show:true}},select:{disabled:true},itemStyle:{borderColor:'#9aa4b2',borderWidth:.7,areaColor:'#f6f8fb'}}]
  });
}
async function drawMaps(){
  if(!state.geoLoaded){
    ['mapCantieri','mapClienti','mapClientiMWp'].forEach(id=>el(id).innerHTML='<div class="error">GeoJSON province non disponibile. Controlla la connessione o scarica il file in data/limits_IT_provinces.geojson.</div>'); return;
  }
  drawMap('mapCantieri', mapDataCantieri(), 'Cantieri FV per provincia', '', 'MWp cantieri');
  drawMap('mapClienti', mapDataClienti('Clienti'), 'Sedi clienti per provincia', '', 'Clienti');
  drawMap('mapClientiMWp', mapDataClienti('MWp'), 'Clienti per provincia - MWp', '', 'MWp collegati');
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
