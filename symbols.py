"""Provider identifiers are kept separate from stock exchange identifiers."""
import re

COINS = [('BTC','Bitcoin','비트코인'),('ETH','Ethereum','이더리움'),('SOL','Solana','솔라나'),('XRP','XRP','리플'),('DOGE','Dogecoin','도지코인'),('ADA','Cardano','에이다'),('AVAX','Avalanche','아발란체'),('LINK','Chainlink','체인링크'),('LTC','Litecoin','라이트코인'),('BCH','Bitcoin Cash','비트코인캐시'),('DOT','Polkadot','폴카닷'),('BNB','BNB','바이낸스코인')]
CRYPTO_ROWS = [dict(tv='CRYPTO:'+ticker+'-USD',symbol='CRYPTO:'+ticker+'-USD',ticker=ticker,name=name+' · '+ko,exchange='암호화폐 USD 종합',type='crypto',providerSymbol=ticker+'-USD') for ticker,name,ko in COINS]
CRYPTO_ALIASES = {}
for ticker,name,ko in COINS:
    for alias in (ticker,ticker+'USD',ticker+'-USD',ticker+'USDT',name,ko):
        CRYPTO_ALIASES[re.sub(r'[\s.,&\-]','',alias.casefold())]=ticker+'-USD'

def provider_symbol(tv):
    ticker=tv.split(':',1)[-1]
    return ticker if tv.startswith('CRYPTO:') else ticker.replace('.','-')

def crypto_rows(q):
    key=re.sub(r'[\s.,&\-]','',q.split(':')[-1].casefold())
    alias=CRYPTO_ALIASES.get(key)
    if ':' in q and not q.upper().startswith('CRYPTO:'):return []
    return [x for x in CRYPTO_ROWS if x['providerSymbol']==alias or key and key in re.sub(r'[\s.,&\-]','',(x['ticker']+' '+x['name']+' '+x['providerSymbol']).casefold())]
