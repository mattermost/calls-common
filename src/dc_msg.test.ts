import {expect} from '@jest/globals';
import {Encoder, Decoder} from '@msgpack/msgpack';

import {DCMessageType} from './types';
import {encodeDCMsg, decodeDCMsg} from './dc_msg';

describe('dcMsg', () => {
    const enc = new Encoder();
    const dec = new Decoder();

    it('ping', () => {
        const pingMsg = encodeDCMsg(enc, DCMessageType.Ping);
        expect(pingMsg).toEqual(new Uint8Array([DCMessageType.Ping]));

        const {mt, payload} = decodeDCMsg(dec, pingMsg);
        expect(mt).toEqual(DCMessageType.Ping);
        expect(payload).toBeUndefined();
    });

    it('pong', () => {
        const pongMsg = encodeDCMsg(enc, DCMessageType.Pong);
        expect(pongMsg).toEqual(new Uint8Array([DCMessageType.Pong]));

        const {mt, payload} = decodeDCMsg(dec, pongMsg);
        expect(mt).toEqual(DCMessageType.Pong);
        expect(payload).toBeUndefined();
    });

    it('sdp', () => {
        const sdp = {
            type: 'offer',
            sdp: 'sdp',
        };
        const sdpMsg = encodeDCMsg(enc, DCMessageType.SDP, sdp);
        const {mt, payload} = decodeDCMsg(dec, sdpMsg);
        expect(mt).toEqual(DCMessageType.SDP);
        expect(JSON.parse(payload)).toEqual(sdp);
    });

    it('lock without payload', () => {
        const lockMsg = encodeDCMsg(enc, DCMessageType.Lock);
        expect(lockMsg).toEqual(new Uint8Array([DCMessageType.Lock]));

        const {mt, payload} = decodeDCMsg(dec, lockMsg);
        expect(mt).toEqual(DCMessageType.Lock);
        expect(payload).toBeUndefined();
    });

    it('lock with payload', () => {
        const lockMsg = encodeDCMsg(enc, DCMessageType.Lock, true);

        const {mt, payload} = decodeDCMsg(dec, lockMsg);
        expect(mt).toEqual(DCMessageType.Lock);
        expect(payload).toEqual(true);
    });

    it('unlock', () => {
        const unlockMsg = encodeDCMsg(enc, DCMessageType.Unlock);
        expect(unlockMsg).toEqual(new Uint8Array([DCMessageType.Unlock]));

        const {mt, payload} = decodeDCMsg(dec, unlockMsg);
        expect(mt).toEqual(DCMessageType.Unlock);
        expect(payload).toBeUndefined();
    });
});
