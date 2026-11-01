// Every data type, and every free source that can supply it.
//
// The point is not to promise ten working sources — it is to know what the alternatives
// are, which need a key, and which countries each covers, so failover can be automatic
// and the UI can say honestly which source answered.

export type DataKind =
  | 'quotes' | 'history' | 'fundamentals' | 'statements' | 'news'
  | 'dividends' | 'splits' | 'analysts' | 'holdings' | 'insiders'
  | 'sectors' | 'earnings' | 'profile' | 'macro' | 'ipo';

export type AccessKind = 'keyless' | 'free-key' | 'paid';

export interface SourceDef {
  id: string;
  name: string;
  kind: DataKind;
  access: AccessKind;
  /** Which market codes it covers; 'ALL' means any. */
  markets: string[];
  /** Lower runs first. */
  priority: number;
  transport: 'json' | 'rss' | 'html' | 'csv';
  note: string;
}

const ALL = ['ALL'];

export const SOURCE_REGISTRY: SourceDef[] = [
  // ---- quotes ----
  { id: 'yahoo-quote', name: 'Yahoo Finance', kind: 'quotes', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: 'cookie + crumb handshake; unofficial' },
  { id: 'stooq-csv', name: 'Stooq', kind: 'quotes', access: 'keyless', markets: ['US', 'GB', 'DE', 'JP'], priority: 20, transport: 'csv', note: 'daily CSV, no key' },
  { id: 'av-quote', name: 'Alpha Vantage', kind: 'quotes', access: 'free-key', markets: ALL, priority: 30, transport: 'json', note: '25 requests/day on the free tier' },
  { id: 'twelve-quote', name: 'Twelve Data', kind: 'quotes', access: 'free-key', markets: ALL, priority: 35, transport: 'json', note: '800 requests/day free' },
  { id: 'finnhub-quote', name: 'Finnhub', kind: 'quotes', access: 'free-key', markets: ['US', 'GB', 'IN'], priority: 40, transport: 'json', note: '60 calls/min free' },
  { id: 'fmp-quote', name: 'Financial Modeling Prep', kind: 'quotes', access: 'free-key', markets: ALL, priority: 45, transport: 'json', note: '250 calls/day free' },
  { id: 'tiingo-quote', name: 'Tiingo', kind: 'quotes', access: 'free-key', markets: ['US'], priority: 50, transport: 'json', note: 'free tier, US only' },
  { id: 'eodhd-quote', name: 'EODHD', kind: 'quotes', access: 'free-key', markets: ALL, priority: 55, transport: 'json', note: '20 calls/day free' },
  { id: 'nse-in', name: 'NSE India', kind: 'quotes', access: 'keyless', markets: ['IN'], priority: 60, transport: 'json', note: 'official; blocks non-browser clients' },
  { id: 'bse-in', name: 'BSE India', kind: 'quotes', access: 'keyless', markets: ['IN'], priority: 65, transport: 'json', note: 'official' },
  { id: 'google-finance', name: 'Google Finance (scrape)', kind: 'quotes', access: 'keyless', markets: ALL, priority: 70, transport: 'html', note: 'fragile; markup changes' },
  { id: 'investing-scrape', name: 'Investing.com (scrape)', kind: 'quotes', access: 'keyless', markets: ALL, priority: 80, transport: 'html', note: 'rate-limited, terms restrict scraping' },

  // ---- history ----
  { id: 'yahoo-chart', name: 'Yahoo chart', kind: 'history', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: 'daily OHLCV, 4-5 years' },
  { id: 'stooq-hist', name: 'Stooq history', kind: 'history', access: 'keyless', markets: ['US', 'GB', 'DE', 'JP'], priority: 20, transport: 'csv', note: 'long daily history' },
  { id: 'av-daily', name: 'Alpha Vantage TIME_SERIES_DAILY', kind: 'history', access: 'free-key', markets: ALL, priority: 30, transport: 'json', note: '20 years, 25/day' },
  { id: 'twelve-ts', name: 'Twelve Data time_series', kind: 'history', access: 'free-key', markets: ALL, priority: 35, transport: 'json', note: '5000 points free' },
  { id: 'fmp-hist', name: 'FMP historical-price', kind: 'history', access: 'free-key', markets: ALL, priority: 40, transport: 'json', note: 'daily' },
  { id: 'eodhd-hist', name: 'EODHD eod', kind: 'history', access: 'free-key', markets: ALL, priority: 45, transport: 'json', note: '30 years on paid' },
  { id: 'tiingo-daily', name: 'Tiingo daily', kind: 'history', access: 'free-key', markets: ['US'], priority: 50, transport: 'json', note: 'US only' },
  { id: 'marketstack', name: 'Marketstack', kind: 'history', access: 'free-key', markets: ALL, priority: 55, transport: 'json', note: '1000 calls/month' },
  { id: 'polygon-daily', name: 'Polygon.io', kind: 'history', access: 'free-key', markets: ['US'], priority: 60, transport: 'json', note: '5 calls/min free' },
  { id: 'nse-bhavcopy', name: 'NSE bhavcopy', kind: 'history', access: 'keyless', markets: ['IN'], priority: 65, transport: 'csv', note: 'official daily file' },
  { id: 'investing-hist', name: 'Investing.com history (scrape)', kind: 'history', access: 'keyless', markets: ALL, priority: 80, transport: 'html', note: 'fragile' },

  // ---- fundamentals / statements ----
  { id: 'yahoo-fund', name: 'Yahoo quoteSummary', kind: 'fundamentals', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: 'the current primary' },
  { id: 'sec-xbrl', name: 'SEC EDGAR XBRL companyfacts', kind: 'statements', access: 'keyless', markets: ['US'], priority: 15, transport: 'json', note: 'official, needs a contact User-Agent' },
  { id: 'av-overview', name: 'Alpha Vantage OVERVIEW', kind: 'fundamentals', access: 'free-key', markets: ALL, priority: 30, transport: 'json', note: '25/day' },
  { id: 'fmp-profile', name: 'FMP profile + key-metrics', kind: 'fundamentals', access: 'free-key', markets: ALL, priority: 35, transport: 'json', note: '250/day' },
  { id: 'finnhub-basic', name: 'Finnhub company basics', kind: 'fundamentals', access: 'free-key', markets: ['US', 'GB', 'IN'], priority: 40, transport: 'json', note: '60/min' },
  { id: 'eodhd-fund', name: 'EODHD fundamentals', kind: 'fundamentals', access: 'free-key', markets: ALL, priority: 45, transport: 'json', note: 'limited free' },
  { id: 'screener-in', name: 'Screener.in (scrape)', kind: 'fundamentals', access: 'keyless', markets: ['IN'], priority: 55, transport: 'html', note: 'excellent Indian coverage; scrape' },
  { id: 'tickertape', name: 'TickerTap (scrape)', kind: 'fundamentals', access: 'keyless', markets: ['IN'], priority: 60, transport: 'html', note: 'Indian ratios' },
  { id: 'stockanalysis', name: 'StockAnalysis (scrape)', kind: 'fundamentals', access: 'keyless', markets: ALL, priority: 65, transport: 'html', note: 'clean statements' },
  { id: 'morningstar', name: 'Morningstar (scrape)', kind: 'fundamentals', access: 'keyless', markets: ALL, priority: 70, transport: 'html', note: 'ratings; terms restrict scraping' },
  { id: 'worldbank', name: 'World Bank API', kind: 'macro', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: 'country macro, no key' },

  // ---- news ----
  { id: 'google-news', name: 'Google News RSS', kind: 'news', access: 'keyless', markets: ALL, priority: 10, transport: 'rss', note: 'the current primary' },
  { id: 'yahoo-news', name: 'Yahoo search news', kind: 'news', access: 'keyless', markets: ALL, priority: 20, transport: 'json', note: '10 items per query' },
  { id: 'bing-news', name: 'Bing News RSS', kind: 'news', access: 'keyless', markets: ALL, priority: 25, transport: 'rss', note: 'no key' },
  { id: 'gdelt', name: 'GDELT 2.0', kind: 'news', access: 'keyless', markets: ALL, priority: 30, transport: 'json', note: 'global event database' },
  { id: 'finnhub-news', name: 'Finnhub company news', kind: 'news', access: 'free-key', markets: ['US', 'GB', 'IN'], priority: 35, transport: 'json', note: '60/min' },
  { id: 'marketaux', name: 'Marketaux', kind: 'news', access: 'free-key', markets: ALL, priority: 40, transport: 'json', note: '100/day' },
  { id: 'newsapi', name: 'NewsAPI.org', kind: 'news', access: 'free-key', markets: ALL, priority: 45, transport: 'json', note: 'dev tier only' },
  { id: 'et-rss', name: 'Economic Times RSS', kind: 'news', access: 'keyless', markets: ['IN'], priority: 50, transport: 'rss', note: 'Indian business press' },
  { id: 'moneycontrol-rss', name: 'Moneycontrol RSS', kind: 'news', access: 'keyless', markets: ['IN'], priority: 55, transport: 'rss', note: 'Indian markets' },
  { id: 'reuters-rss', name: 'Reuters business RSS', kind: 'news', access: 'keyless', markets: ALL, priority: 60, transport: 'rss', note: 'global' },
  { id: 'reddit-json', name: 'Reddit search JSON', kind: 'news', access: 'keyless', markets: ALL, priority: 75, transport: 'json', note: 'sentiment, low signal' },

  // ---- dividends / splits / earnings / analysts / holdings / insiders ----
  { id: 'yahoo-div', name: 'Yahoo chart events', kind: 'dividends', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: 'dividends + splits in one call' },
  { id: 'av-div', name: 'Alpha Vantage DIVIDENDS', kind: 'dividends', access: 'free-key', markets: ALL, priority: 30, transport: 'json', note: 'full history' },
  { id: 'fmp-div', name: 'FMP dividends', kind: 'dividends', access: 'free-key', markets: ALL, priority: 35, transport: 'json', note: '' },
  { id: 'eodhd-div', name: 'EODHD dividends', kind: 'dividends', access: 'free-key', markets: ALL, priority: 40, transport: 'json', note: '' },
  { id: 'nse-corp', name: 'NSE corporate actions', kind: 'dividends', access: 'keyless', markets: ['IN'], priority: 50, transport: 'csv', note: 'official' },
  { id: 'yahoo-split', name: 'Yahoo chart events', kind: 'splits', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: '' },
  { id: 'av-split', name: 'Alpha Vantage SPLITS', kind: 'splits', access: 'free-key', markets: ALL, priority: 30, transport: 'json', note: '' },
  { id: 'yahoo-earn', name: 'Yahoo earningsTrend/History', kind: 'earnings', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: 'estimates + surprises' },
  { id: 'finnhub-earn', name: 'Finnhub earnings calendar', kind: 'earnings', access: 'free-key', markets: ['US', 'GB', 'IN'], priority: 30, transport: 'json', note: '' },
  { id: 'fmp-earn', name: 'FMP earnings calendar', kind: 'earnings', access: 'free-key', markets: ALL, priority: 35, transport: 'json', note: '' },
  { id: 'yahoo-rec', name: 'Yahoo recommendationTrend', kind: 'analysts', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: '' },
  { id: 'finnhub-rec', name: 'Finnhub recommendations', kind: 'analysts', access: 'free-key', markets: ['US', 'GB'], priority: 30, transport: 'json', note: '' },
  { id: 'fmp-rec', name: 'FMP analyst estimates', kind: 'analysts', access: 'free-key', markets: ALL, priority: 35, transport: 'json', note: '' },
  { id: 'yahoo-hold', name: 'Yahoo majorHolders', kind: 'holdings', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: '' },
  { id: 'sec-13f', name: 'SEC 13F', kind: 'holdings', access: 'keyless', markets: ['US'], priority: 20, transport: 'json', note: 'institutional filings' },
  { id: 'yahoo-insider', name: 'Yahoo insiderTransactions', kind: 'insiders', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: '' },
  { id: 'sec-form4', name: 'SEC Form 4', kind: 'insiders', access: 'keyless', markets: ['US'], priority: 20, transport: 'json', note: 'official insider filings' },
  { id: 'nse-shp', name: 'NSE shareholding pattern', kind: 'holdings', access: 'keyless', markets: ['IN'], priority: 30, transport: 'csv', note: 'official promoter/FII split' },

  // ---- sectors / profile / ipo ----
  { id: 'yahoo-screener', name: 'Yahoo sector screener', kind: 'sectors', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: 'the directory source' },
  { id: 'yahoo-exchange', name: 'Yahoo exchange screener', kind: 'sectors', access: 'keyless', markets: ALL, priority: 15, transport: 'json', note: 'used where sectors return nothing' },
  { id: 'wikipedia', name: 'Wikipedia index tables', kind: 'sectors', access: 'keyless', markets: ['IN', 'US', 'GB', 'DE', 'SG', 'HK', 'AU', 'CA'], priority: 30, transport: 'html', note: 'index constituents' },
  { id: 'yahoo-profile', name: 'Yahoo assetProfile', kind: 'profile', access: 'keyless', markets: ALL, priority: 10, transport: 'json', note: 'business summary, employees' },
  { id: 'wikipedia-profile', name: 'Wikipedia article', kind: 'profile', access: 'keyless', markets: ALL, priority: 30, transport: 'html', note: 'narrative description' },
  { id: 'sec-s1', name: 'SEC EDGAR S-1/F-1', kind: 'ipo', access: 'keyless', markets: ['US'], priority: 10, transport: 'json', note: 'pre-IPO filings' },
  { id: 'ipo-calendar', name: 'IPO calendar APIs', kind: 'ipo', access: 'free-key', markets: ALL, priority: 20, transport: 'json', note: 'FMP / API Ninjas shapes' },

  // ---- statements: official registries first, then aggregators ----
  { id: 'companies-house', name: 'UK Companies House API', kind: 'statements', access: 'free-key', markets: ['GB'], priority: 20, transport: 'json', note: 'official UK filings' },
  { id: 'edinet', name: 'EDINET (Japan FSA)', kind: 'statements', access: 'keyless', markets: ['JP'], priority: 22, transport: 'json', note: 'official Japanese filings' },
  { id: 'mca-in', name: 'MCA India filings', kind: 'statements', access: 'keyless', markets: ['IN'], priority: 24, transport: 'html', note: 'official Indian registry' },
  { id: 'av-statements', name: 'Alpha Vantage INCOME_STATEMENT', kind: 'statements', access: 'free-key', markets: ALL, priority: 32, transport: 'json', note: '5 years' },
  { id: 'fmp-statements', name: 'FMP financial statements', kind: 'statements', access: 'free-key', markets: ALL, priority: 36, transport: 'json', note: '' },
  { id: 'eodhd-statements', name: 'EODHD financials', kind: 'statements', access: 'free-key', markets: ALL, priority: 42, transport: 'json', note: '' },
  { id: 'finnhub-statements', name: 'Finnhub financials-reported', kind: 'statements', access: 'free-key', markets: ['US', 'GB', 'IN'], priority: 46, transport: 'json', note: '' },
  { id: 'screener-statements', name: 'Screener.in (scrape)', kind: 'statements', access: 'keyless', markets: ['IN'], priority: 56, transport: 'html', note: '10-year Indian statements' },
  { id: 'stockanalysis-statements', name: 'StockAnalysis (scrape)', kind: 'statements', access: 'keyless', markets: ALL, priority: 62, transport: 'html', note: '' },

  // ---- macro ----
  { id: 'imf', name: 'IMF Data API', kind: 'macro', access: 'keyless', markets: ALL, priority: 12, transport: 'json', note: 'country macro' },
  { id: 'fred', name: 'FRED (St. Louis Fed)', kind: 'macro', access: 'free-key', markets: ['US'], priority: 15, transport: 'json', note: 'US series' },
  { id: 'oecd', name: 'OECD SDMX', kind: 'macro', access: 'keyless', markets: ALL, priority: 18, transport: 'json', note: 'developed-market indicators' },
  { id: 'eurostat', name: 'Eurostat', kind: 'macro', access: 'keyless', markets: ['DE', 'GB'], priority: 22, transport: 'json', note: 'European series' },
  { id: 'rbi', name: 'RBI India', kind: 'macro', access: 'keyless', markets: ['IN'], priority: 26, transport: 'csv', note: 'central-bank series' },
  { id: 'dbnomics', name: 'DBnomics', kind: 'macro', access: 'keyless', markets: ALL, priority: 30, transport: 'json', note: 'aggregates many providers' },
  { id: 'datagovin', name: 'data.gov.in', kind: 'macro', access: 'free-key', markets: ['IN'], priority: 34, transport: 'json', note: 'Indian open data' },
  { id: 'tradingeconomics', name: 'Trading Economics (scrape)', kind: 'macro', access: 'keyless', markets: ALL, priority: 70, transport: 'html', note: 'terms restrict scraping' },
  { id: 'nasdaq-datalink', name: 'Nasdaq Data Link', kind: 'macro', access: 'free-key', markets: ALL, priority: 60, transport: 'json', note: 'free datasets' },

  // ---- splits ----
  { id: 'fmp-split', name: 'FMP splits', kind: 'splits', access: 'free-key', markets: ALL, priority: 32, transport: 'json', note: '' },
  { id: 'eodhd-split', name: 'EODHD splits', kind: 'splits', access: 'free-key', markets: ALL, priority: 36, transport: 'json', note: '' },
  { id: 'tiingo-split', name: 'Tiingo splits', kind: 'splits', access: 'free-key', markets: ['US'], priority: 40, transport: 'json', note: '' },
  { id: 'polygon-split', name: 'Polygon splits', kind: 'splits', access: 'free-key', markets: ['US'], priority: 44, transport: 'json', note: '' },
  { id: 'nse-corp-split', name: 'NSE corporate actions', kind: 'splits', access: 'keyless', markets: ['IN'], priority: 50, transport: 'csv', note: '' },
  { id: 'bse-corp-split', name: 'BSE corporate actions', kind: 'splits', access: 'keyless', markets: ['IN'], priority: 54, transport: 'csv', note: '' },
  { id: 'investing-split', name: 'Investing.com splits (scrape)', kind: 'splits', access: 'keyless', markets: ALL, priority: 75, transport: 'html', note: '' },
  { id: 'stockanalysis-split', name: 'StockAnalysis splits (scrape)', kind: 'splits', access: 'keyless', markets: ALL, priority: 70, transport: 'html', note: '' },

  // ---- insiders ----
  { id: 'finnhub-insider', name: 'Finnhub insider transactions', kind: 'insiders', access: 'free-key', markets: ['US'], priority: 30, transport: 'json', note: '' },
  { id: 'fmp-insider', name: 'FMP insider trading', kind: 'insiders', access: 'free-key', markets: ['US'], priority: 34, transport: 'json', note: '' },
  { id: 'nse-sast', name: 'NSE SAST disclosures', kind: 'insiders', access: 'keyless', markets: ['IN'], priority: 38, transport: 'csv', note: 'official Indian insider filings' },
  { id: 'bse-insider', name: 'BSE insider trading', kind: 'insiders', access: 'keyless', markets: ['IN'], priority: 42, transport: 'html', note: '' },
  { id: 'marketbeat-insider', name: 'MarketBeat (scrape)', kind: 'insiders', access: 'keyless', markets: ['US'], priority: 65, transport: 'html', note: '' },
  { id: 'insidermonkey', name: 'Insider Monkey (scrape)', kind: 'insiders', access: 'keyless', markets: ['US'], priority: 70, transport: 'html', note: '' },
  { id: 'tipranks-insider', name: 'TipRanks (scrape)', kind: 'insiders', access: 'keyless', markets: ALL, priority: 75, transport: 'html', note: '' },
  { id: 'trendlyne-insider', name: 'Trendlyne (scrape)', kind: 'insiders', access: 'keyless', markets: ['IN'], priority: 60, transport: 'html', note: '' },

  // ---- profile ----
  { id: 'fmp-profile2', name: 'FMP company profile', kind: 'profile', access: 'free-key', markets: ALL, priority: 20, transport: 'json', note: '' },
  { id: 'finnhub-profile', name: 'Finnhub company profile', kind: 'profile', access: 'free-key', markets: ['US', 'GB', 'IN'], priority: 24, transport: 'json', note: '' },
  { id: 'eodhd-profile', name: 'EODHD company profile', kind: 'profile', access: 'free-key', markets: ALL, priority: 28, transport: 'json', note: '' },
  { id: 'wikidata', name: 'Wikidata SPARQL', kind: 'profile', access: 'keyless', markets: ALL, priority: 32, transport: 'json', note: 'structured facts' },
  { id: 'opencorporates', name: 'OpenCorporates', kind: 'profile', access: 'free-key', markets: ALL, priority: 36, transport: 'json', note: 'legal entity registry' },
  { id: 'gleif', name: 'GLEIF LEI', kind: 'profile', access: 'keyless', markets: ALL, priority: 40, transport: 'json', note: 'legal entity identifiers' },
  { id: 'stockanalysis-profile', name: 'StockAnalysis (scrape)', kind: 'profile', access: 'keyless', markets: ALL, priority: 60, transport: 'html', note: '' },
  { id: 'crunchbase-free', name: 'Crunchbase (limited)', kind: 'profile', access: 'free-key', markets: ALL, priority: 65, transport: 'json', note: 'private/young companies' },

  // ---- holdings ----
  { id: 'fmp-holdings', name: 'FMP institutional holders', kind: 'holdings', access: 'free-key', markets: ['US'], priority: 30, transport: 'json', note: '' },
  { id: 'finnhub-holdings', name: 'Finnhub ownership', kind: 'holdings', access: 'free-key', markets: ['US', 'GB'], priority: 34, transport: 'json', note: '' },
  { id: 'bse-shp', name: 'BSE shareholding pattern', kind: 'holdings', access: 'keyless', markets: ['IN'], priority: 36, transport: 'html', note: '' },
  { id: 'screener-shp', name: 'Screener.in shareholding (scrape)', kind: 'holdings', access: 'keyless', markets: ['IN'], priority: 40, transport: 'html', note: '' },
  { id: 'moneycontrol-shp', name: 'Moneycontrol (scrape)', kind: 'holdings', access: 'keyless', markets: ['IN'], priority: 45, transport: 'html', note: '' },
  { id: 'tipranks-holdings', name: 'TipRanks (scrape)', kind: 'holdings', access: 'keyless', markets: ALL, priority: 65, transport: 'html', note: '' },
  { id: 'marketbeat-holdings', name: 'MarketBeat (scrape)', kind: 'holdings', access: 'keyless', markets: ['US'], priority: 70, transport: 'html', note: '' },

  // ---- earnings ----
  { id: 'eodhd-earn', name: 'EODHD earnings', kind: 'earnings', access: 'free-key', markets: ALL, priority: 32, transport: 'json', note: '' },
  { id: 'av-earn', name: 'Alpha Vantage EARNINGS', kind: 'earnings', access: 'free-key', markets: ALL, priority: 36, transport: 'json', note: '' },
  { id: 'nse-results', name: 'NSE results calendar', kind: 'earnings', access: 'keyless', markets: ['IN'], priority: 40, transport: 'csv', note: 'official' },
  { id: 'bse-results', name: 'BSE results calendar', kind: 'earnings', access: 'keyless', markets: ['IN'], priority: 44, transport: 'html', note: '' },
  { id: 'nasdaq-earn', name: 'Nasdaq earnings API', kind: 'earnings', access: 'keyless', markets: ['US'], priority: 48, transport: 'json', note: 'public endpoint' },
  { id: 'zacks-earn', name: 'Zacks (scrape)', kind: 'earnings', access: 'keyless', markets: ['US'], priority: 65, transport: 'html', note: '' },
  { id: 'tipranks-earn', name: 'TipRanks (scrape)', kind: 'earnings', access: 'keyless', markets: ALL, priority: 70, transport: 'html', note: '' },
  { id: 'investing-earn', name: 'Investing.com calendar (scrape)', kind: 'earnings', access: 'keyless', markets: ALL, priority: 75, transport: 'html', note: '' },

  // ---- analysts ----
  { id: 'eodhd-rec', name: 'EODHD analyst ratings', kind: 'analysts', access: 'free-key', markets: ALL, priority: 32, transport: 'json', note: '' },
  { id: 'zacks-rec', name: 'Zacks ranks (scrape)', kind: 'analysts', access: 'keyless', markets: ['US'], priority: 60, transport: 'html', note: '' },
  { id: 'tipranks-rec', name: 'TipRanks (scrape)', kind: 'analysts', access: 'keyless', markets: ALL, priority: 64, transport: 'html', note: '' },
  { id: 'marketbeat-rec', name: 'MarketBeat (scrape)', kind: 'analysts', access: 'keyless', markets: ['US'], priority: 68, transport: 'html', note: '' },
  { id: 'nasdaq-rec', name: 'Nasdaq analyst ratings', kind: 'analysts', access: 'keyless', markets: ['US'], priority: 72, transport: 'json', note: '' },
  { id: 'stockanalysis-rec', name: 'StockAnalysis (scrape)', kind: 'analysts', access: 'keyless', markets: ALL, priority: 76, transport: 'html', note: '' },
  { id: 'trendlyne-rec', name: 'Trendlyne (scrape)', kind: 'analysts', access: 'keyless', markets: ['IN'], priority: 58, transport: 'html', note: '' },

  // ---- sectors ----
  { id: 'fmp-sector', name: 'FMP sector performance', kind: 'sectors', access: 'free-key', markets: ['US'], priority: 20, transport: 'json', note: '' },
  { id: 'finviz-sector', name: 'Finviz (scrape)', kind: 'sectors', access: 'keyless', markets: ['US'], priority: 55, transport: 'html', note: '' },
  { id: 'nse-indices', name: 'NSE sector indices', kind: 'sectors', access: 'keyless', markets: ['IN'], priority: 40, transport: 'csv', note: 'official sector indices' },
  { id: 'bse-indices', name: 'BSE sector indices', kind: 'sectors', access: 'keyless', markets: ['IN'], priority: 44, transport: 'html', note: '' },
  { id: 'investing-sector', name: 'Investing.com sectors (scrape)', kind: 'sectors', access: 'keyless', markets: ALL, priority: 70, transport: 'html', note: '' },
  { id: 'stockanalysis-sector', name: 'StockAnalysis sectors (scrape)', kind: 'sectors', access: 'keyless', markets: ALL, priority: 66, transport: 'html', note: '' },
  { id: 'tradingview-sector', name: 'TradingView (scrape)', kind: 'sectors', access: 'keyless', markets: ALL, priority: 78, transport: 'html', note: 'terms restrict scraping' },

  // ---- ipo ----
  { id: 'nasdaq-ipo', name: 'Nasdaq IPO calendar', kind: 'ipo', access: 'keyless', markets: ['US'], priority: 25, transport: 'json', note: 'public endpoint' },
  { id: 'nse-ipo', name: 'NSE IPO listings', kind: 'ipo', access: 'keyless', markets: ['IN'], priority: 28, transport: 'csv', note: 'official' },
  { id: 'bse-ipo', name: 'BSE IPO listings', kind: 'ipo', access: 'keyless', markets: ['IN'], priority: 32, transport: 'html', note: '' },
  { id: 'chittorgarh', name: 'Chittorgarh IPO (scrape)', kind: 'ipo', access: 'keyless', markets: ['IN'], priority: 45, transport: 'html', note: 'main Indian IPO tracker' },
  { id: 'renaissance-ipo', name: 'Renaissance Capital IPO', kind: 'ipo', access: 'keyless', markets: ['US'], priority: 50, transport: 'html', note: '' },
  { id: 'investing-ipo', name: 'Investing.com IPOs (scrape)', kind: 'ipo', access: 'keyless', markets: ALL, priority: 70, transport: 'html', note: '' },
  { id: 'stockanalysis-ipo', name: 'StockAnalysis IPOs (scrape)', kind: 'ipo', access: 'keyless', markets: ['US'], priority: 66, transport: 'html', note: '' },
  { id: 'finnhub-ipo', name: 'Finnhub IPO calendar', kind: 'ipo', access: 'free-key', markets: ['US'], priority: 35, transport: 'json', note: '' },

  // ---- fundamentals: fill to 10+ ----
  { id: 'investing-fund', name: 'Investing.com ratios (scrape)', kind: 'fundamentals', access: 'keyless', markets: ALL, priority: 72, transport: 'html', note: '' },
  { id: 'tradingview-fund', name: 'TradingView financials (scrape)', kind: 'fundamentals', access: 'keyless', markets: ALL, priority: 78, transport: 'html', note: '' },
  { id: 'wallmine', name: 'Wallmine (scrape)', kind: 'fundamentals', access: 'keyless', markets: ['US'], priority: 74, transport: 'html', note: '' },
  { id: 'trendlyne-fund', name: 'Trendlyne (scrape)', kind: 'fundamentals', access: 'keyless', markets: ['IN'], priority: 58, transport: 'html', note: 'Indian ratios' },

  // ---- dividends: fill to 10+ ----
  { id: 'tiingo-div', name: 'Tiingo dividends', kind: 'dividends', access: 'free-key', markets: ['US'], priority: 34, transport: 'json', note: '' },
  { id: 'polygon-div', name: 'Polygon dividends', kind: 'dividends', access: 'free-key', markets: ['US'], priority: 38, transport: 'json', note: '' },
  { id: 'bse-corp-div', name: 'BSE corporate actions', kind: 'dividends', access: 'keyless', markets: ['IN'], priority: 54, transport: 'csv', note: '' },
  { id: 'stockanalysis-div', name: 'StockAnalysis dividends (scrape)', kind: 'dividends', access: 'keyless', markets: ALL, priority: 64, transport: 'html', note: '' },
  { id: 'investing-div', name: 'Investing.com dividends (scrape)', kind: 'dividends', access: 'keyless', markets: ALL, priority: 72, transport: 'html', note: '' },
];

/** Sources for a data type, best first, filtered to what the market can use. */
export function sourcesFor(kind: DataKind, market?: string): SourceDef[] {
  return SOURCE_REGISTRY
    .filter((s) => s.kind === kind)
    .filter((s) => !market || s.markets.includes('ALL') || s.markets.includes(market.toUpperCase()))
    .sort((a, b) => a.priority - b.priority);
}

/** How many sources exist per data type — the honest coverage table. */
export function registrySummary(): Array<{ kind: DataKind; total: number; keyless: number; freeKey: number }> {
  const kinds = [...new Set(SOURCE_REGISTRY.map((s) => s.kind))] as DataKind[];
  return kinds.map((kind) => {
    const all = SOURCE_REGISTRY.filter((s) => s.kind === kind);
    return {
      kind, total: all.length,
      keyless: all.filter((s) => s.access === 'keyless').length,
      freeKey: all.filter((s) => s.access === 'free-key').length,
    };
  }).sort((a, b) => b.total - a.total);
}
