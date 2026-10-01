use crate::stage::StageIndex;
use memchr::memmem;
use serde::Serialize;
use std::collections::{BTreeMap,HashMap,HashSet};

const MARKER:&[u8]=&[0xff;16];
const MARKER_SUFFIX:u8=0x01;
const RECORD_FROM_MARKER:usize=30;
const ENTITY_OFFSET:usize=0;
const DBID_OFFSET:usize=4;
const DBID_COPY_OFFSET:usize=8;
const ENTITY_MIN:u32=1;
const ENTITY_MAX:u32=199_999;
const DBID_MIN:u32=1;
const DBID_MAX:u32=i32::MAX as u32;
const CONSTANTS:&[(isize,u8)]=&[
    (-8,7),(-6,0),(-4,7),(-1,255),(12,0),(15,1),(22,0),(23,0),(24,0),(25,0),(26,1),(32,2),(40,3),(55,6),(60,7)
];

#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct CompetitionCore{
    pub id:u32,
    pub database_id:Option<u32>,
    pub name:Option<String>,
    pub stage_ids:Vec<u32>,
}
#[derive(Debug,Default,Serialize)]
#[serde(rename_all="camelCase")]
pub struct CompetitionStats{
    pub competitions:usize,
    pub with_database_id:usize,
    pub database_id_conflicts:usize,
    pub with_name:usize,
    pub pair_records:usize,
}
#[derive(Debug,Clone)]
pub struct CompetitionIndex{
    by_id:HashMap<u32,CompetitionCore>,
}
impl CompetitionIndex{
    pub fn build(game_db:&[u8],stages:&StageIndex,names:&HashMap<u32,String>)->(Self,CompetitionStats){
        let (pairs,pair_records)=locate_pairs(game_db);
        let ids:Vec<u32>=stages.competition_ids().collect();
        let mut db_claims:HashMap<u32,Vec<u32>>=HashMap::new();
        for id in &ids {if let Some(db)=pairs.get(id){db_claims.entry(*db).or_default().push(*id);}}
        let contested:HashSet<u32>=db_claims.values().filter(|v|v.len()>1).flatten().copied().collect();
        let mut stats=CompetitionStats{competitions:ids.len(),database_id_conflicts:contested.len(),pair_records,..Default::default()};
        let mut by_id=HashMap::new();
        for id in ids {
            let db=if contested.contains(&id){None}else{pairs.get(&id).copied()};
            if db.is_some(){stats.with_database_id+=1;}
            let name=db.and_then(|x|names.get(&x).cloned());
            if name.is_some(){stats.with_name+=1;}
            let stage_ids=stages.stages.iter().filter(|s|s.competition_id==Some(id)).map(|s|s.id).collect();
            by_id.insert(id,CompetitionCore{id,database_id:db,name,stage_ids});
        }
        (Self{by_id},stats)
    }
    pub fn competition(&self,id:u32)->Option<&CompetitionCore>{self.by_id.get(&id)}
}
fn locate_pairs(buf:&[u8])->(BTreeMap<u32,u32>,usize){
    let mut claims:HashMap<u32,HashSet<u32>>=HashMap::new(); let mut records=0;
    let mut pattern=Vec::from(MARKER); pattern.push(MARKER_SUFFIX);
    for marker in memmem::find_iter(buf,&pattern){
        let start=marker+RECORD_FROM_MARKER;
        if !constants_match(buf,start){continue;}
        let entity=match read_u32(buf,start+ENTITY_OFFSET){Some(v)=>v,None=>continue};
        let db=match read_u32(buf,start+DBID_OFFSET){Some(v)=>v,None=>continue};
        let copy=read_u32(buf,start+DBID_COPY_OFFSET).unwrap_or(0);
        if db!=copy || !(ENTITY_MIN..=ENTITY_MAX).contains(&entity) || !(DBID_MIN..=DBID_MAX).contains(&db){continue;}
        claims.entry(entity).or_default().insert(db); records+=1;
    }
    let out=claims.into_iter().filter_map(|(e,v)|(v.len()==1).then(||(e,*v.iter().next().unwrap()))).collect();
    (out,records)
}
fn constants_match(buf:&[u8],start:usize)->bool{
    CONSTANTS.iter().all(|(off,val)|{
        let at=if *off>=0{start.checked_add(*off as usize)}else{start.checked_sub(off.unsigned_abs())};
        at.and_then(|x|buf.get(x)).is_some_and(|b|b==val)
    })
}
fn read_u32(b:&[u8],o:usize)->Option<u32>{Some(u32::from_le_bytes(b.get(o..o+4)?.try_into().ok()?))}
