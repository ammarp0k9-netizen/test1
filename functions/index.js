'use strict';

const { randomUUID } = require('node:crypto');
const { getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { createDeleteContentWorldHandler } = require('./delete-content-world');
const {
  createDeleteContentRankHandler,
  createDuplicateContentRankHandler
} = require('./content-rank-admin');
const {
  createDeleteContentGateHandler,
  createDuplicateContentGateHandler,
  createMoveContentGateHandler
} = require('./content-gate-admin');
const {
  createBulkUpdateContentWordsHandler,
  createDeleteContentWordHandler,
  createDuplicateContentWordHandler,
  createMoveContentWordHandler
} = require('./content-word-admin');

// Reuse the process-wide Admin app when this module is loaded more than once
// by the Functions runtime or emulator.
const adminApp = getApps()[0] || initializeApp();
const db = getFirestore(adminApp);

const deleteContentWorldHandler = createDeleteContentWorldHandler({
  db,
  FieldValue,
  HttpsError,
  makeRequestId: randomUUID
});

const rankHandlerDependencies = {
  db,
  FieldValue,
  HttpsError,
  makeRequestId: randomUUID
};
const deleteContentRankHandler = createDeleteContentRankHandler(rankHandlerDependencies);
const duplicateContentRankHandler = createDuplicateContentRankHandler(rankHandlerDependencies);
const gateHandlerDependencies = {
  db,
  FieldValue,
  HttpsError
};
const deleteContentGateHandler = createDeleteContentGateHandler(gateHandlerDependencies);
const duplicateContentGateHandler = createDuplicateContentGateHandler(gateHandlerDependencies);
const moveContentGateHandler = createMoveContentGateHandler(gateHandlerDependencies);
const wordHandlerDependencies = {
  db,
  FieldValue,
  HttpsError
};
const bulkUpdateContentWordsHandler = createBulkUpdateContentWordsHandler(wordHandlerDependencies);
const deleteContentWordHandler = createDeleteContentWordHandler(wordHandlerDependencies);
const duplicateContentWordHandler = createDuplicateContentWordHandler(wordHandlerDependencies);
const moveContentWordHandler = createMoveContentWordHandler(wordHandlerDependencies);

exports.deleteContentWorld = onCall({
  memory: '512MiB',
  timeoutSeconds: 540
}, deleteContentWorldHandler);

exports.deleteContentRank = onCall({
  memory: '512MiB',
  timeoutSeconds: 540
}, deleteContentRankHandler);

exports.duplicateContentRank = onCall({
  memory: '512MiB',
  timeoutSeconds: 540
}, duplicateContentRankHandler);

exports.deleteContentGate = onCall({
  memory: '512MiB',
  timeoutSeconds: 540
}, deleteContentGateHandler);

exports.duplicateContentGate = onCall({
  memory: '512MiB',
  timeoutSeconds: 540
}, duplicateContentGateHandler);

exports.moveContentGate = onCall({
  memory: '512MiB',
  timeoutSeconds: 540
}, moveContentGateHandler);

exports.duplicateContentWord = onCall({
  memory: '512MiB',
  timeoutSeconds: 120
}, duplicateContentWordHandler);

exports.moveContentWord = onCall({
  memory: '512MiB',
  timeoutSeconds: 120
}, moveContentWordHandler);

exports.bulkUpdateContentWords = onCall({
  memory: '512MiB',
  timeoutSeconds: 120
}, bulkUpdateContentWordsHandler);

exports.deleteContentWord = onCall({
  memory: '512MiB',
  timeoutSeconds: 120
}, deleteContentWordHandler);
