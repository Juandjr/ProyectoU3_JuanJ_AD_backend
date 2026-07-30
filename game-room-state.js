const userRoomMap = new Map();
const roomDifficultyMap = new Map();

function setRoomDifficulty(roomId, difficulty) {
  if (!roomId) return;
  roomDifficultyMap.set(roomId, difficulty || 'MEDIUM');
}

function setUserRoom(userId, roomId, difficulty) {
  if (!userId) return;
  if (roomId) {
    userRoomMap.set(userId, roomId);
    setRoomDifficulty(roomId, difficulty);
  } else {
    userRoomMap.delete(userId);
  }
}

function clearUserRoom(userId) {
  if (!userId) return;
  userRoomMap.delete(userId);
}

function getUserRoom(userId) {
  return userId ? userRoomMap.get(userId) : null;
}

function getRoomDifficulty(roomId) {
  return roomId ? roomDifficultyMap.get(roomId) || 'MEDIUM' : 'MEDIUM';
}

function getUserDifficulty(userId) {
  const roomId = getUserRoom(userId);
  return getRoomDifficulty(roomId);
}

module.exports = {
  setRoomDifficulty,
  setUserRoom,
  clearUserRoom,
  getUserRoom,
  getRoomDifficulty,
  getUserDifficulty
};
