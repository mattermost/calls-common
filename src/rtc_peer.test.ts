import {expect, describe, it, beforeEach, afterEach} from '@jest/globals';

import {RTCPeer} from './rtc_peer';
import * as dcMsg from './dc_msg';

// Mock the dc_msg module
jest.mock('./dc_msg');

describe('RTCPeer', () => {
    let peer: RTCPeer;
    let mockConfig: RTCPeerConfig;
    let mockPC: RTCPeerConnection;
    let mockDC: RTCDataChannel;

    beforeEach(() => {
        // Setup mocks for dc_msg
        jest.mocked(dcMsg.encodeDCMsg).mockReturnValue(new Uint8Array([1]));
        jest.mocked(dcMsg.encodeDCMsg).mockImplementation(() => ({}));

        // Mock RTCPeerConnection
        mockPC = {
            createDataChannel: jest.fn(),
            onnegotiationneeded: null,
            onicecandidate: null,
            oniceconnectionstatechange: null,
            onconnectionstatechange: null,
            ontrack: null,
            close: jest.fn(),
        };

        // Mock DataChannel
        mockDC = {
            readyState: 'open',
            binaryType: 'arraybuffer',
            onmessage: null,
            send: jest.fn(),
        };

        // Mock logger
        const mockLogger = {
            logDebug: jest.fn(),
            logErr: jest.fn(),
            logWarn: jest.fn(),
            logInfo: jest.fn(),
        };

        mockConfig = {
            iceServers: [],
            logger: mockLogger,
            simulcast: false,
            dcSignaling: true,
        };

        // Mock RTCPeerConnection constructor
        global.RTCPeerConnection = jest.fn().mockImplementation(() => mockPC);
        mockPC.createDataChannel.mockReturnValue(mockDC);

        // Mock setInterval and setTimeout
        jest.useFakeTimers();

        // Create RTCPeer instance
        peer = new RTCPeer(mockConfig);

        // Expose private properties for testing
        peer.dc = mockDC;
        peer.dcNegotiated = true;
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe('grabSignalingLock', () => {
        it('should resolve when lock is acquired', async () => {
            // Setup the test to simulate a successful lock acquisition
            const lockPromise = peer.grabSignalingLock(1000);

            // Simulate the server responding with a successful lock acquisition
            const dcLockResponseCb = peer.dcLockResponseCb;
            expect(dcLockResponseCb).toBeTruthy();

            // Verify that the lock request was sent
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Simulate server response (lock acquired)
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();

            // Verify that the callback was cleared
            expect(peer.dcLockResponseCb).toBeNull();
        });

        it('should retry when lock is not acquired', async () => {
            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate server response (lock not acquired)
            dcLockResponseCb(false);

            // Fast-forward timers to trigger the retry
            jest.advanceTimersByTime(50);

            // Verify that another lock request was sent
            expect(mockDC.send).toHaveBeenCalledTimes(2);

            // Now simulate a successful lock acquisition
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();
        });

        it('should reject when timeout occurs', async () => {
            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Fast-forward timers to trigger the timeout
            jest.advanceTimersByTime(1000);

            // Wait for the promise to reject
            await expect(lockPromise).rejects.toThrow('timed out waiting for lock');

            // Verify that the callback was cleared
            expect(peer.dcLockResponseCb).toBeNull();
        });

        it('should queue lock request when data channel is not ready', async () => {
            // Set data channel to not ready
            mockDC.readyState = 'connecting';

            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Verify that no lock request was sent immediately
            expect(mockDC.send).not.toHaveBeenCalled();

            // Fast-forward timers to trigger the retry
            jest.advanceTimersByTime(50);

            // Verify that a lock request was queued
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Now set data channel to ready and simulate a successful lock acquisition
            mockDC.readyState = 'open';

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate server response (lock acquired)
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();
        });

        it('should queue lock request when data channel is not negotiated', async () => {
            // Set data channel to not negotiated
            peer.dcNegotiated = false;

            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Verify that no lock request was sent immediately
            expect(mockDC.send).not.toHaveBeenCalled();

            // Fast-forward timers to trigger the retry
            jest.advanceTimersByTime(50);

            // Verify that a lock request was queued
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Now set data channel to negotiated and simulate a successful lock acquisition
            peer.dcNegotiated = true;

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate server response (lock acquired)
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();
        });
    });
});
