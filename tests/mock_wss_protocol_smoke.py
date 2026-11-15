"""Real local TLS WebSocket handshake and signal protocol smoke test.
Does not contact Amazon or Oracle; requires openssl and python websockets.
"""
import asyncio
import json
import os
import ssl
import subprocess
import sys
import tempfile
from pathlib import Path

from websockets.asyncio.client import connect

ROOT = Path(__file__).resolve().parents[1]

async def main():
    with tempfile.TemporaryDirectory(prefix='amazon-signal-test-') as td:
        cert = Path(td) / 'cert.pem'; key = Path(td) / 'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes',
          '-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost'],
          stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
        env = os.environ.copy(); env['MOCK_RECEIVER_TOKEN']='test-only-device-secret-123456'
        proc = subprocess.Popen([sys.executable,str(ROOT/'tools/mock_oracle_broadcast.py'),
          '--cert',str(cert),'--key',str(key),'--receiver-id','receiver-01',
          '--port','19443','--count','1','--interval','0.2'],env=env,
          stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            ctx = ssl._create_unverified_context()  # only this throwaway loopback test cert
            last=None
            for _ in range(40):
                try:
                    async with connect('wss://127.0.0.1:19443',ssl=ctx) as ws:
                        await ws.send(json.dumps({'type':'authenticate',
                            'receiver_id':'receiver-01','token':env['MOCK_RECEIVER_TOKEN']}))
                        ack = json.loads(await asyncio.wait_for(ws.recv(),timeout=4))
                        assert ack == {'type':'authenticated','receiver_id':'receiver-01'},ack
                        event = json.loads(await asyncio.wait_for(ws.recv(),timeout=4))
                        assert event['type']=='new_job_detected'
                        assert event['job_id']=='MOCK-JOB-1'
                        assert event['detector_id']=='mock-detector-01'
                        assert event['event_id']
                        await ws.send(json.dumps({'type':'ping'}))
                        pong=json.loads(await asyncio.wait_for(ws.recv(),timeout=4))
                        assert pong['type']=='pong',pong
                        print('PASS: mock local WSS auth, job event and heartbeat')
                        return
                except (ConnectionRefusedError,OSError) as e:
                    last=e
                    await asyncio.sleep(.10)
            raise RuntimeError(f'Test server did not start: {last}')
        finally:
            proc.terminate()
            try:proc.wait(timeout=3)
            except subprocess.TimeoutExpired:proc.kill()

if __name__=='__main__':asyncio.run(main())
