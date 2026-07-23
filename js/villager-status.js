// Workforce status shared by the HUD and idle-villager selection control.

export function isIdleVillager(unit) {
  return Boolean(
    unit?.alive
      && unit.type === 'villager'
      && unit.state === 'idle'
      && !unit.job
      && !unit.orderTarget
      && !unit.target
      && !unit.deferredAttack
      && !unit.wallMount
      && !unit.wallOrder
      && !unit.moving
      && !Number.isFinite(unit.orderX)
      && !Number.isFinite(unit.orderY),
  );
}

export function getVillagerStatus(world, sideIndex = 0) {
  const villagers = (world?.units || [])
    .filter(unit => unit.alive && unit.side === sideIndex && unit.type === 'villager');
  const idleVillagers = villagers.filter(isIdleVillager);
  return {
    total: villagers.length,
    idle: idleVillagers.length,
    idleVillagers,
  };
}

export function getNextIdleVillager(world, sideIndex = 0, currentId = null) {
  const { idleVillagers } = getVillagerStatus(world, sideIndex);
  if (!idleVillagers.length) return null;
  const afterId = Number.isFinite(currentId) ? currentId : -Infinity;
  let first = idleVillagers[0];
  let next = null;
  for (const villager of idleVillagers) {
    if (villager.id < first.id) first = villager;
    if (villager.id > afterId && (!next || villager.id < next.id)) next = villager;
  }
  return next || first;
}
