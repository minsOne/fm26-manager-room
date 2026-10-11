/** Display labels only. Parser keys, role identities, archive data and calculations stay unchanged. */
export const attributeLabels=Object.freeze({
  crossing:'크로스',dribbling:'드리블',finishing:'골 결정력',heading:'헤더',longShots:'중거리 슛',
  marking:'일대일 마크',offTheBall:'공 없는 움직임',passing:'패스',penaltyTaking:'페널티킥',tackling:'태클',vision:'시야',
  handling:'볼 핸들링',aerialReach:'공중 장악력',commandOfArea:'페널티 박스 장악력',communication:'수비 조율',
  kicking:'골킥',throwing:'공 던지기',anticipation:'예측력',decisions:'판단력',oneOnOnes:'일대일 방어',
  positioning:'위치 선정',reflexes:'반사 신경',firstTouch:'퍼스트 터치',technique:'개인기',flair:'천재성',
  corners:'코너킥',teamwork:'팀워크',workRate:'활동량',longThrows:'장거리 스로인',eccentricity:'기행',
  rushingOut:'돌진 빈도',punching:'펀칭 빈도',acceleration:'순간 속도',freeKickTaking:'프리킥',strength:'몸싸움',
  stamina:'지구력',pace:'주력',jumpingReach:'점프 거리',leadership:'리더십',dirtiness:'더티 플레이',
  balance:'균형 감각',bravery:'대담성',consistency:'꾸준함',aggression:'적극성',agility:'민첩성',
  importantMatches:'중요 경기 활약',injuryProneness:'부상 빈도',versatility:'다재다능',naturalFitness:'타고난 체력',
  determination:'승부욕',composure:'침착성',concentration:'집중력',adaptability:'적응력',ambition:'야망',
  loyalty:'충성심',pressure:'압박 대처',professionalism:'프로 의식',sportsmanship:'스포츠맨십',temperament:'참을성',controversy:'논쟁성'
});
const roles=Object.freeze({
  'Goalkeeper':'골키퍼','Sweeper Keeper':'스위퍼 키퍼','Central Defender':'중앙 수비수',
  'Ball Playing Defender':'볼 플레이잉 수비수','Full Back':'풀백','Wing Back':'윙백',
  'Holding Midfielder':'홀딩 미드필더','Deep Lying Playmaker':'딥라잉 플레이메이커',
  'Central Midfielder':'중앙 미드필더','Advanced Playmaker':'전진형 플레이메이커',
  'Winger':'윙어','Inside Forward':'인사이드 포워드','Advanced Forward':'전진형 포워드','Pressing Forward':'압박형 포워드'
});
export const attributeLabel=key=>Object.hasOwn(attributeLabels,key)?attributeLabels[key]:`미번역 항목 (${String(key)})`;
export const roleLabel=key=>key==null?null:Object.hasOwn(roles,key)?roles[key]:key;
export const ageLabel=player=>Number.isInteger(player?.age)&&player.age>=14&&player.age<=100?`만 ${player.age}세`:'나이 미확인';
