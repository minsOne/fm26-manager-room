use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

const ROW_BYTES: usize = 33;
const PREVIOUS_OFFSET: usize = 0;
const STAGE_ID_OFFSET: usize = 4;
const STAGE_ID_COPY_OFFSET: usize = 8;
const ZERO_OFFSET: usize = 12;
const COMPETITION_ID_OFFSET: usize = 13;
const GROUP_ID_OFFSET: usize = 17;
const ROUND_OFFSET: usize = 21;
const UNKNOWN_S25_OFFSET: usize = 25;
const UNKNOWN_S29_OFFSET: usize = 29;
const STAGE_ID_MAX: u32 = 200_000;
const COMPETITION_ID_LIMIT: u32 = 1_000_000;
const INITIAL_SEARCH_BYTES: usize = 2_000_000;
const MAX_SEARCH_BYTES: usize = 32 * 1024 * 1024;
const CHAIN_ROWS: usize = 200;
const RESYNC_BYTES: usize = 4_096;
const MISSING: u32 = u32::MAX;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct StageCore {
    pub id: u32,
    pub competition_id: Option<u32>,
    pub group_id: Option<u32>,
    pub round_raw: Option<u32>,
    pub round_name: Option<&'static str>,
    pub previous_stage_id: Option<u32>,
    pub unknown_s25: u32,
    pub unknown_s29: u32,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all="camelCase")]
pub struct StageStats {
    pub rows: usize,
    pub gaps: usize,
    pub with_competition: usize,
    pub competition_id_rejected: usize,
    pub bytes_after_table: usize,
    pub id_sum: u64,
    pub competition_id_sum: u64,
    pub round_raw_sum: u64,
}

#[derive(Debug, Clone)]
pub struct StageIndex {
    pub stages: Vec<StageCore>,
    by_id: HashMap<u32, usize>,
    competition_ids: BTreeMap<u32, Vec<u32>>,
}

impl StageIndex {
    pub fn scan(game_db:&[u8]) -> Option<(Self, StageStats)> {
        let start=find_table_start(game_db)?;
        let (stages,gaps,end)=walk(game_db,start);
        if stages.is_empty(){return None;}
        let mut by_id=HashMap::with_capacity(stages.len());
        let mut competition_ids:BTreeMap<u32,Vec<u32>>=BTreeMap::new();
        let mut stats=StageStats{rows:stages.len(),gaps,bytes_after_table:game_db.len().saturating_sub(end),..Default::default()};
        for (i,s) in stages.iter().enumerate(){
            if by_id.insert(s.id,i).is_some(){return None;}
            stats.id_sum+=s.id as u64;
            if let Some(cid)=s.competition_id {
                stats.with_competition+=1;
                stats.competition_id_sum+=cid as u64;
                competition_ids.entry(cid).or_default().push(s.id);
            } else if read_u32(game_db, start + i*ROW_BYTES + COMPETITION_ID_OFFSET).is_some_and(|v|v!=MISSING&&v>=COMPETITION_ID_LIMIT){
                stats.competition_id_rejected+=1;
            }
            stats.round_raw_sum+=s.round_raw.unwrap_or(0) as u64;
        }
        Some((Self{stages,by_id,competition_ids},stats))
    }
    pub fn stage(&self,id:u32)->Option<&StageCore>{self.by_id.get(&id).map(|i|&self.stages[*i])}
    pub fn competition_ids(&self)->impl Iterator<Item=u32>+'_ { self.competition_ids.keys().copied() }
}

fn find_table_start(buf:&[u8])->Option<usize>{
    let mut searched_from=buf.len();
    let mut window=INITIAL_SEARCH_BYTES;
    while searched_from>0 {
        let start=buf.len().saturating_sub(window);
        if let Some(found)=find_between(buf,start,searched_from){return Some(found);}
        if window>=MAX_SEARCH_BYTES{return None;}
        searched_from=start;
        window=(window*2).min(MAX_SEARCH_BYTES);
    }
    None
}
fn find_between(buf:&[u8],first:usize,end:usize)->Option<usize>{
    let last=end.min(buf.len().saturating_sub(ROW_BYTES)+1);
    let mut at=first;
    while at<last {
        if buf.get(at+ZERO_OFFSET)==Some(&0) && row_valid(buf,at) && chain_valid(buf,at) {
            let limit=(at+ROW_BYTES).min(buf.len());
            let candidates=(at..limit).filter(|&o|chain_valid(buf,o));
            let mut best=None;
            for o in candidates {
                let score=chain_steps(buf,o);
                if best.is_none_or(|(_,s)|score>s){best=Some((o,score));}
            }
            let mut start=best?.0;
            while start>=ROW_BYTES && row_valid(buf,start-ROW_BYTES){start-=ROW_BYTES;}
            return Some(start);
        }
        at+=1;
    }
    None
}
fn chain_valid(buf:&[u8],at:usize)->bool{(0..CHAIN_ROWS).all(|i|row_valid(buf,at+i*ROW_BYTES))}
fn chain_steps(buf:&[u8],at:usize)->usize{
    let mut prev=None; let mut score=0;
    for i in 0..CHAIN_ROWS {
        let id=read_u32(buf,at+i*ROW_BYTES+STAGE_ID_OFFSET).unwrap_or(0);
        if prev.is_some_and(|p|id==p+1){score+=1;} prev=Some(id);
    } score
}
fn row_valid(buf:&[u8],at:usize)->bool{
    if at+ROW_BYTES>buf.len() || buf[at+ZERO_OFFSET]!=0{return false;}
    let id=match read_u32(buf,at+STAGE_ID_OFFSET){Some(v)=>v,None=>return false};
    let copy=read_u32(buf,at+STAGE_ID_COPY_OFFSET).unwrap_or(0);
    if id==0||id>=STAGE_ID_MAX||copy!=id{return false;}
    let prev=read_u32(buf,at+PREVIOUS_OFFSET).unwrap_or(0);
    prev==MISSING || prev==id.saturating_sub(1)
}
fn walk(buf:&[u8],start:usize)->(Vec<StageCore>,usize,usize){
    let mut out=Vec::new(); let mut gaps=0; let mut at=start; let mut end=start;
    while at+ROW_BYTES<=buf.len(){
        if row_valid(buf,at){
            out.push(decode(buf,at)); at+=ROW_BYTES; end=at; continue;
        }
        let furthest=(at+RESYNC_BYTES).min(buf.len().saturating_sub(ROW_BYTES));
        let mut found=None;
        for c in at+1..=furthest {
            if buf[c+ZERO_OFFSET]==0 && row_valid(buf,c){found=Some(c);break;}
        }
        match found {Some(v)=>{gaps+=1;at=v},None=>break}
    }
    (out,gaps,end)
}
fn decode(buf:&[u8],at:usize)->StageCore{
    let id=read_u32(buf,at+STAGE_ID_OFFSET).unwrap();
    let cid=read_u32(buf,at+COMPETITION_ID_OFFSET).unwrap_or(MISSING);
    let group=read_u32(buf,at+GROUP_ID_OFFSET).unwrap_or(MISSING);
    let round=read_u32(buf,at+ROUND_OFFSET).unwrap_or(MISSING);
    let prev=read_u32(buf,at+PREVIOUS_OFFSET).unwrap_or(MISSING);
    StageCore{
        id,
        competition_id:(cid!=MISSING&&cid<COMPETITION_ID_LIMIT).then_some(cid),
        group_id:(group!=MISSING).then_some(group),
        round_raw:(round!=MISSING).then_some(round),
        round_name:round_name(round),
        previous_stage_id:(prev!=MISSING).then_some(prev),
        unknown_s25:read_u32(buf,at+UNKNOWN_S25_OFFSET).unwrap_or(0),
        unknown_s29:read_u32(buf,at+UNKNOWN_S29_OFFSET).unwrap_or(MISSING),
    }
}
fn round_name(raw:u32)->Option<&'static str>{
    match raw {7=>Some("Third Round"),8=>Some("Fourth Round"),16=>Some("Quarter Final"),17=>Some("Semi Final"),19=>Some("Final"),_=>None}
}
fn read_u32(b:&[u8],o:usize)->Option<u32>{Some(u32::from_le_bytes(b.get(o..o+4)?.try_into().ok()?))}
