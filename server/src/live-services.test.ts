import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLiveServicesNote, parseSdmStatus } from './live-services.ts';

const SDM_STATUS = [
  '     DATASOURCE                                                    STATUS               ADDRESS             TYPE                TAGS',
  '     ☢️ prod: EnactServices: MongoDB: replica (read-only)          connected            127.0.0.1:32000     mongoReplicaSet     db-rw=r,env=prd,service=enactservices,type=mongodb',
  '     ☮️ dev: Analytics: MongoDB (read-only)                        not connected        127.0.0.1:22010     mongoReplicaSet     db-rw=r,env=dev,service=analytics,type=mongodb',
  '     ☮️ dev: EnactServices: MongoDB (read-only)                    connected            127.0.0.1:22000     mongoReplicaSet     db-rw=r,env=dev,service=enactservices,type=mongodb,owner=a=b',
  '     ☮️ dev: EnactServices: MongoDB (read/write)                   connected            127.0.0.1:22001     mongoReplicaSet     db-rw=rw,env=dev,service=enactservices,type=mongodb',
  '     internal tool                                                 connected            127.0.0.1:9000      http',
  '',
].join('\n');

test('keeps every connected tunnel with its environment and access, the emoji prefix dropped from its name', () => {
  assert.deepEqual(parseSdmStatus(SDM_STATUS), [
    { name: 'prod: EnactServices: MongoDB: replica (read-only)', address: '127.0.0.1:32000', type: 'mongoReplicaSet', dev: false, readOnly: true },
    { name: 'dev: EnactServices: MongoDB (read-only)', address: '127.0.0.1:22000', type: 'mongoReplicaSet', dev: true, readOnly: true },
    { name: 'dev: EnactServices: MongoDB (read/write)', address: '127.0.0.1:22001', type: 'mongoReplicaSet', dev: true, readOnly: false },
    { name: 'internal tool', address: '127.0.0.1:9000', type: 'http', dev: false, readOnly: false },
  ]);
});

test('a tag value containing "=" is kept whole', () => {
  const [service] = parseSdmStatus('dev db  connected  127.0.0.1:1  postgres  env=dev,db-rw=r,note=a=b');
  assert.deepEqual(service, { name: 'dev db', address: '127.0.0.1:1', type: 'postgres', dev: true, readOnly: true });
  assert.deepEqual(parseSdmStatus('x  connected  127.0.0.1:2  postgres  env=dev=old,db-rw=r')[0]?.dev, false);
});

test('agents are offered only the read-only dev tunnels and told never to connect to the others', () => {
  const [offered, forbidden, ...rest] = agentLiveServicesNote(parseSdmStatus(SDM_STATUS));
  assert.equal(offered, 'Read-only dev services connected on this machine (StrongDM tunnels on localhost, no credentials needed): dev: EnactServices: MongoDB (read-only) at 127.0.0.1:22000 (mongoReplicaSet).');
  assert.equal(forbidden, 'Never connect to these tunnels (production, read/write or untagged): 127.0.0.1:32000, 127.0.0.1:22001, 127.0.0.1:9000.');
  assert.deepEqual(rest, []);
  assert.ok(!offered.includes('22001') && !offered.includes('read/write'));
});

test('no connected tunnels add nothing to the prompt', () => {
  assert.deepEqual(agentLiveServicesNote([]), []);
});

test('output that is not an sdm status table yields nothing', () => {
  assert.deepEqual(parseSdmStatus('You are not logged in. Run `sdm login`.\n'), []);
});
