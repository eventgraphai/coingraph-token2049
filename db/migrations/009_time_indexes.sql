-- Time-only indexes for retention scans (min(time) / day ranges) on the large time-series tables.
create index if not exists cex_ohlcv_ts_idx on cex_ohlcv (ts);
create index if not exists open_interest_snapshots_ts_idx on open_interest_snapshots (exchange_ts);
create index if not exists futures_sentiment_ts_idx on futures_sentiment_snapshots (ts);
create index if not exists cex_ticker_snapshots_time_idx on cex_ticker_snapshots (captured_at);
create index if not exists funding_rate_snapshots_time_idx on funding_rate_snapshots (captured_at);
create index if not exists derivatives_tickers_time_idx on derivatives_tickers (captured_at);
create index if not exists category_snapshots_time_idx on category_snapshots (captured_at);
create index if not exists dex_pool_snapshots_time_idx on dex_pool_snapshots (captured_at);
create index if not exists order_book_snapshots_time_idx on order_book_snapshots (captured_at);
create index if not exists exchange_status_time_idx on exchange_status (captured_at);
