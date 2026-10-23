// Classic Age of Empires cheat codes (typed in chat, only when the lobby
// enabled "Cho phép cheat"). They go through lockstep like any command.
import { GAIA } from './constants.js';
import { killEntity } from './combat.js';

export const CHEAT_LIST = [
  ['pepperoni pizza', '+1000 thịt'], ['coinage', '+1000 vàng'], ['woodstock', '+1000 gỗ'], ['quarry', '+1000 đá'],
  ['steroids', 'Xây/tạo/nghiên cứu siêu nhanh'], ['reveal map', 'Mở bản đồ'], ['no fog', 'Bỏ sương mù'],
  ['home run', 'Thắng ngay'], ['resign', 'Đầu hàng'], ['diediedie', 'Tiêu diệt tất cả đối thủ'], ['kill1..kill8', 'Tiêu diệt người chơi số X'],
  ['bigdaddy', 'Xe hơi bắn tên lửa'], ['photon man', 'Lính laser'], ['e=mc2 trooper', 'Lính hạt nhân'],
  ['hoyohoyo', 'Phù thủy siêu tốc 600 máu'], ['icbm', 'Ballista tầm 100'], ['big bertha', 'Cẩu đá to tầm xa hơn'],
];

function spawnNearTC(world, p, type) {
  let tc = null;
  for (const b of p.buildings) if (b.type === 'town_center' && b.built) { tc = b; break; }
  const ref = tc || [...p.units][0];
  if (!ref) return;
  const pos = tc ? world.spawnPointNear(tc, tc.x + 3, tc.y + 3) : { x: ref.x + 1, y: ref.y };
  world.spawnUnit(type, p.id, pos.x, pos.y);
}

function wipe(world, pid) {
  const p = world.players[pid];
  if (!p || pid === GAIA) return;
  for (const e of [...p.units]) killEntity(world, e, null, 'cheat');
  for (const e of [...p.buildings]) killEntity(world, e, null, 'cheat');
}

export function applyCheat(world, p, raw) {
  if (!world.settings.cheats) return false;
  const code = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let ok = true;
  switch (code) {
    case 'pepperoni pizza': p.res.food += 1000; break;
    case 'coinage': p.res.gold += 1000; break;
    case 'woodstock': p.res.wood += 1000; break;
    case 'quarry': p.res.stone += 1000; break;
    case 'steroids':
      if (p.flags.has('cheat:steroids')) p.flags.delete('cheat:steroids'); else p.flags.add('cheat:steroids');
      break;
    case 'reveal map': p.flags.add('cheat:reveal'); break;
    case 'no fog': p.flags.add('cheat:nofog'); break;
    case 'home run':
      for (const q of world.realPlayers()) if (!world.isAlly(q.id, p.id)) { q.resigned = true; wipe(world, q.id); }
      break;
    case 'resign': p.resigned = true; wipe(world, p.id); break;
    case 'diediedie':
      for (const q of world.realPlayers()) if (q.id !== p.id) wipe(world, q.id);
      break;
    case 'bigdaddy': case 'big daddy': spawnNearTC(world, p, 'big_daddy'); break;
    case 'photon man': spawnNearTC(world, p, 'photon_man'); break;
    case 'e=mc2 trooper': spawnNearTC(world, p, 'nuke_trooper'); break;
    case 'hoyohoyo': p.flags.add('cheat:hoyohoyo'); world.refreshStats(p); break;
    case 'icbm': p.flags.add('cheat:icbm'); world.refreshStats(p); break;
    case 'big bertha': p.flags.add('cheat:bigbertha'); world.refreshStats(p); break;
    default: {
      const m = code.match(/^kill([1-8])$/);
      if (m) { const id = Number(m[1]); if (id !== p.id) wipe(world, id); }
      else ok = false;
    }
  }
  if (ok) {
    world.msg(-1, `${p.name} đã dùng cheat: ${code}`, '#ffe070');
    world.emit({ t: 'cheat', p: p.id, code });
  }
  return ok;
}
