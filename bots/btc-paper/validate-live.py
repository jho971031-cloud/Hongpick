"""Bounded, public-data-only process validation. Never loads exchange credentials."""
import datetime as dt,hashlib,json,os,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parent
suffix=str(time.time_ns())
data=root/('validation-data-'+suffix);data.mkdir(exist_ok=True)
if (data/'state.json').exists():raise RuntimeError('Use a fresh validation directory; preserve previous evidence')
env=dict(os.environ,PAPER_DATA_DIR=str(data));log=(data/'process.log').open('w')
process=subprocess.Popen(['node',str(root/'bot.cjs')],env=env,stdout=log,stderr=subprocess.STDOUT)
result={'mode':'PAPER_ONLY','startedAt':dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(),'checks':{}}
try:
 deadline=time.monotonic()+45
 while time.monotonic()<deadline:
  if process.poll() is not None:raise RuntimeError('Bot stopped: '+(data/'process.log').read_text())
  try:
   health=json.loads((data/'health.json').read_text())
   if health['marketHealthy']:break
  except (FileNotFoundError,json.JSONDecodeError):pass
  time.sleep(.5)
 else:raise RuntimeError('No healthy public-data observation')
 result['checks']['publicTickerAndClosedCandles']=True
 duplicate=subprocess.run(['node',str(root/'bot.cjs'),'--once'],env=env,capture_output=True,text=True,timeout=15)
 assert duplicate.returncode!=0 and 'holds the paper lock' in duplicate.stderr
 assert process.poll() is None
 result['checks']['secondProcessRejected']=True
 subprocess.run(['node',str(root/'control.cjs'),'pause'],env=env,check=True,capture_output=True)
 deadline=time.monotonic()+12
 while time.monotonic()<deadline:
  if json.loads((data/'health.json').read_text()).get('entryPaused'):break
  time.sleep(.5)
 else:raise AssertionError('Paper pause command not applied')
 result['checks']['paperPauseCommand']=True
 subprocess.run(['node',str(root/'control.cjs'),'resume'],env=env,check=True,capture_output=True)
 deadline=time.monotonic()+12
 while time.monotonic()<deadline:
  if not json.loads((data/'health.json').read_text()).get('entryPaused'):break
  time.sleep(.5)
 else:raise AssertionError('Paper resume command not applied')
 result['checks']['paperResumeCommand']=True
 time.sleep(5)
 assert json.loads((data/'health.json').read_text())['marketHealthy']
 process.terminate();assert process.wait(timeout=20)==0
 result['checks']['gracefulShutdownCheckpoint']=True
 restarted=subprocess.run(['node',str(root/'bot.cjs'),'--once'],env=env,capture_output=True,text=True,timeout=40)
 assert restarted.returncode==0,restarted.stderr
 result['checks']['restartAndFreshQuote']=True
 status=subprocess.run(['node',str(root/'status.cjs')],env=env,capture_output=True,text=True,timeout=10)
 assert status.returncode==0,status.stderr
 result['status']=json.loads(status.stdout)
 result['checks']['statusAndLedger']=True
 bad=root/('validation-corrupt-'+suffix);bad.mkdir(exist_ok=True)
 e=json.loads((data/'state.json').read_text());e['body']=e['body'].replace('"cash":','"cash":9',1)
 damaged=json.dumps(e);(bad/'state.json').write_text(damaged)
 rejected=subprocess.run(['node',str(root/'bot.cjs'),'--once'],env=dict(env,PAPER_DATA_DIR=str(bad)),capture_output=True,text=True,timeout=15)
 assert rejected.returncode!=0 and 'checksum' in rejected.stderr
 assert (bad/'state.json').read_text()==damaged
 result['checks']['corruptCheckpointRefusedWithoutOverwrite']=True
 result['completedAt']=dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat()
 (root/'validation-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print(json.dumps(result,ensure_ascii=False,indent=2))
finally:
 if process.poll() is None:process.terminate();process.wait(timeout=20)
 log.close()
