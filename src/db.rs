use alloy_primitives::Address;
use rusqlite::Connection;
use std::{
    fmt::{Debug, Formatter},
    sync::{Arc, Mutex, MutexGuard},
};

/// Thread-safe database wrapper using Arc<Mutex<Connection>>.
///
/// This pattern allows the database to be safely shared between:
/// - Multiple async tasks in the web server
/// - The ExEx notification handler
///
/// Since we use separate binaries, each process gets its own Database instance,
/// but SQLite WAL mode allows concurrent reads across processes.
#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
}

impl Debug for Database {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").finish_non_exhaustive()
    }
}

impl Database {
    /// Create new database with the provided path.
    pub fn new(path: &str) -> eyre::Result<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let database = Self {
            connection: Arc::new(Mutex::new(connection)),
        };
        database.create_tables()?;
        Ok(database)
    }

    /// Acquire a lock on the database connection.
    fn connection(&self) -> MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .expect("failed to acquire database lock")
    }

    /// Create all required tables if they don't exist.
    fn create_tables(&self) -> eyre::Result<()> {
        let conn = self.connection();
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS blocks (
                block_number INTEGER PRIMARY KEY,
                block_timestamp INTEGER NOT NULL,
                tx_count INTEGER NOT NULL,
                total_blobs INTEGER NOT NULL,
                gas_used INTEGER NOT NULL,
                gas_price INTEGER NOT NULL,
                excess_blob_gas INTEGER NOT NULL DEFAULT 0
            )
            "#,
            (),
        )?;

        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS senders (
                address TEXT PRIMARY KEY,
                tx_count INTEGER NOT NULL DEFAULT 0,
                total_blobs INTEGER NOT NULL DEFAULT 0
            )
            "#,
            (),
        )?;

        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS blob_transactions (
                tx_hash TEXT PRIMARY KEY,
                block_number INTEGER NOT NULL,
                sender TEXT NOT NULL,
                blob_count INTEGER NOT NULL,
                gas_price INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )
            "#,
            (),
        )?;

        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS blob_hashes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tx_hash TEXT NOT NULL,
                blob_hash TEXT NOT NULL,
                blob_index INTEGER NOT NULL
            )
            "#,
            (),
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_blob_txs_block ON blob_transactions(block_number)",
            (),
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_blob_txs_sender ON blob_transactions(sender)",
            (),
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_blob_txs_created ON blob_transactions(created_at)",
            (),
        )?;

        Ok(())
    }

    /// Insert a block with blob statistics.
    pub fn insert_block(
        &self,
        block_number: u64,
        block_timestamp: u64,
        tx_count: u64,
        total_blobs: u64,
        gas_used: i64,
        gas_price: i64,
        excess_blob_gas: i64,
    ) -> eyre::Result<()> {
        self.connection().execute(
            "INSERT OR REPLACE INTO blocks VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                block_number,
                block_timestamp,
                tx_count,
                total_blobs,
                gas_used,
                gas_price,
                excess_blob_gas,
            ),
        )?;
        Ok(())
    }

    /// Insert a blob transaction.
    pub fn insert_blob_transaction(
        &self,
        tx_hash: &str,
        block_number: u64,
        sender: &str,
        blob_count: i64,
        gas_price: i64,
        created_at: u64,
    ) -> eyre::Result<()> {
        self.connection().execute(
            "INSERT OR REPLACE INTO blob_transactions VALUES (?, ?, ?, ?, ?, ?)",
            (
                tx_hash,
                block_number,
                sender,
                blob_count,
                gas_price,
                created_at,
            ),
        )?;
        Ok(())
    }

    /// Insert a blob hash for a transaction.
    pub fn insert_blob_hash(
        &self,
        tx_hash: &str,
        blob_hash: &str,
        blob_index: i64,
    ) -> eyre::Result<()> {
        self.connection().execute(
            "INSERT INTO blob_hashes (tx_hash, blob_hash, blob_index) VALUES (?, ?, ?)",
            (tx_hash, blob_hash, blob_index),
        )?;
        Ok(())
    }

    /// Update sender statistics (upsert).
    pub fn update_sender(&self, sender: &Address, num_blobs: u64) -> eyre::Result<()> {
        self.connection().execute(
            r#"
            INSERT INTO senders (address, tx_count, total_blobs)
            VALUES (?, 1, ?)
            ON CONFLICT(address) DO UPDATE SET
                tx_count = tx_count + 1,
                total_blobs = total_blobs + ?
            "#,
            (sender.to_string(), num_blobs, num_blobs),
        )?;
        Ok(())
    }

    /// Delete a block and its associated data (for reverts).
    pub fn delete_block(&self, block_number: u64) -> eyre::Result<()> {
        self.connection()
            .execute("DELETE FROM blocks WHERE block_number = ?", (block_number,))?;
        Ok(())
    }

    /// Get overall statistics.
    pub fn get_stats(&self) -> eyre::Result<Stats> {
        let conn = self.connection();

        let total_blocks: u64 = conn
            .query_row("SELECT COUNT(*) FROM blocks", [], |row| row.get(0))
            .unwrap_or(0);

        let total_blobs: u64 = conn
            .query_row(
                "SELECT COALESCE(SUM(blob_count), 0) FROM blob_transactions",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let total_transactions: u64 = conn
            .query_row("SELECT COALESCE(SUM(tx_count), 0) FROM blocks", [], |row| {
                row.get(0)
            })
            .unwrap_or(0);

        let latest_block: Option<u64> = conn
            .query_row("SELECT MAX(block_number) FROM blocks", [], |row| row.get(0))
            .ok();

        let earliest_block: Option<u64> = conn
            .query_row("SELECT MIN(block_number) FROM blocks", [], |row| row.get(0))
            .ok();

        let latest_gas_price: u64 = conn
            .query_row(
                "SELECT gas_price FROM blocks ORDER BY block_number DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let avg_blobs_per_block = if total_blocks > 0 {
            total_blobs as f64 / total_blocks as f64
        } else {
            0.0
        };

        Ok(Stats {
            total_blocks,
            total_blobs,
            total_transactions,
            avg_blobs_per_block,
            latest_block,
            earliest_block,
            latest_gas_price,
        })
    }

    /// Get recent blocks with their transactions.
    pub fn get_recent_blocks(&self, limit: u64) -> eyre::Result<Vec<BlockData>> {
        let conn = self.connection();

        let mut stmt = conn.prepare(
            "SELECT block_number, block_timestamp, tx_count, total_blobs, gas_used, gas_price, excess_blob_gas
             FROM blocks ORDER BY block_number DESC LIMIT ?",
        )?;

        let block_data: Vec<(u64, u64, u64, u64, u64, u64, u64)> = stmt
            .query_map([limit], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let mut blocks = Vec::with_capacity(block_data.len());

        for (
            block_number,
            block_timestamp,
            tx_count,
            total_blobs,
            gas_used,
            gas_price,
            excess_blob_gas,
        ) in block_data
        {
            let mut tx_stmt = conn.prepare(
                "SELECT tx_hash, sender, blob_count FROM blob_transactions WHERE block_number = ?",
            )?;

            let transactions: Vec<TransactionData> = tx_stmt
                .query_map([block_number], |row| {
                    Ok(TransactionData {
                        tx_hash: row.get(0)?,
                        sender: row.get(1)?,
                        blob_count: row.get(2)?,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();

            blocks.push(BlockData {
                block_number,
                block_timestamp,
                tx_count,
                total_blobs,
                gas_used,
                gas_price,
                excess_blob_gas,
                transactions,
            });
        }

        Ok(blocks)
    }

    /// Get a specific block by number.
    pub fn get_block(&self, block_number: u64) -> eyre::Result<Option<BlockData>> {
        let conn = self.connection();

        let block_row: Option<(u64, u64, u64, u64, u64, u64)> = conn
            .query_row(
                "SELECT block_timestamp, tx_count, total_blobs, gas_used, gas_price, excess_blob_gas
                 FROM blocks WHERE block_number = ?",
                [block_number],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .ok();

        if let Some((
            block_timestamp,
            tx_count,
            total_blobs,
            gas_used,
            gas_price,
            excess_blob_gas,
        )) = block_row
        {
            let mut tx_stmt = conn.prepare(
                "SELECT tx_hash, sender, blob_count FROM blob_transactions WHERE block_number = ?",
            )?;

            let transactions: Vec<TransactionData> = tx_stmt
                .query_map([block_number], |row| {
                    Ok(TransactionData {
                        tx_hash: row.get(0)?,
                        sender: row.get(1)?,
                        blob_count: row.get(2)?,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();

            Ok(Some(BlockData {
                block_number,
                block_timestamp,
                tx_count,
                total_blobs,
                gas_used,
                gas_price,
                excess_blob_gas,
                transactions,
            }))
        } else {
            Ok(None)
        }
    }

    /// Get top senders by total blobs.
    pub fn get_top_senders(&self, limit: u64) -> eyre::Result<Vec<SenderData>> {
        let conn = self.connection();

        let mut stmt = conn.prepare(
            "SELECT address, tx_count, total_blobs
             FROM senders ORDER BY total_blobs DESC LIMIT ?",
        )?;

        let senders: Vec<SenderData> = stmt
            .query_map([limit], |row| {
                Ok(SenderData {
                    address: row.get(0)?,
                    tx_count: row.get(1)?,
                    total_blobs: row.get(2)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(senders)
    }

    /// Get chart data for the last N blocks.
    pub fn get_chart_data(&self, num_blocks: u64) -> eyre::Result<ChartData> {
        let conn = self.connection();

        let latest_block: u64 = conn
            .query_row("SELECT MAX(block_number) FROM blocks", [], |row| row.get(0))
            .unwrap_or(0);

        if latest_block == 0 {
            return Ok(ChartData {
                labels: Vec::new(),
                blobs: Vec::new(),
                gas_prices: Vec::new(),
            });
        }

        let start_block = latest_block.saturating_sub(num_blocks - 1);

        let mut stmt = conn.prepare(
            "SELECT block_number, total_blobs, gas_price
             FROM blocks
             WHERE block_number >= ? AND block_number <= ?
             ORDER BY block_number ASC",
        )?;

        let mut block_data: std::collections::HashMap<u64, (u64, u64)> =
            std::collections::HashMap::new();
        let mut last_gas_price: u64 = 0;

        let rows = stmt.query_map([start_block, latest_block], |row| {
            Ok((
                row.get::<_, u64>(0)?,
                row.get::<_, u64>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })?;

        for row in rows.flatten() {
            block_data.insert(row.0, (row.1, row.2));
            last_gas_price = row.2;
        }

        let mut labels = Vec::with_capacity(num_blocks as usize);
        let mut blobs = Vec::with_capacity(num_blocks as usize);
        let mut gas_prices = Vec::with_capacity(num_blocks as usize);

        for block_num in start_block..=latest_block {
            labels.push(block_num);
            if let Some((blob_count, gas_price)) = block_data.get(&block_num) {
                blobs.push(*blob_count);
                gas_prices.push(*gas_price as f64 / 1e9);
                last_gas_price = *gas_price;
            } else {
                blobs.push(0);
                gas_prices.push(last_gas_price as f64 / 1e9);
            }
        }

        Ok(ChartData {
            labels,
            blobs,
            gas_prices,
        })
    }

    /// Get recent blob transactions.
    pub fn get_blob_transactions(&self, limit: u64) -> eyre::Result<Vec<BlobTransactionData>> {
        let conn = self.connection();

        let mut stmt = conn.prepare(
            "SELECT tx_hash, block_number, sender, blob_count, gas_price
             FROM blob_transactions
             ORDER BY created_at DESC
             LIMIT ?",
        )?;

        let txs: Vec<(String, u64, String, u64, u64)> = stmt
            .query_map([limit], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let mut result = Vec::with_capacity(txs.len());

        for (tx_hash, block_number, sender, blob_count, gas_price) in txs {
            let mut blob_stmt = conn.prepare(
                "SELECT blob_hash FROM blob_hashes WHERE tx_hash = ? ORDER BY blob_index",
            )?;

            let blob_hashes: Vec<String> = blob_stmt
                .query_map([&tx_hash], |row| row.get(0))?
                .filter_map(|r| r.ok())
                .collect();

            result.push(BlobTransactionData {
                tx_hash,
                block_number,
                sender,
                blob_count,
                gas_price,
                blob_hashes,
            });
        }

        Ok(result)
    }

    /// Get all-time chart data with smoothing for visualization.
    /// Returns sampled data points to keep the chart performant.
    pub fn get_all_time_chart_data(
        &self,
        target_points: u64,
        bpo2_timestamp: u64,
    ) -> eyre::Result<AllTimeChartData> {
        let conn = self.connection();

        // BPO1 parameters (before BPO2)
        const BPO1_TARGET: u64 = 6;
        const BPO1_MAX: u64 = 9;
        // BPO2 parameters
        const BPO2_TARGET: u64 = 10;
        const BPO2_MAX: u64 = 15;

        // Get total block count and range
        let (min_block, max_block): (u64, u64) = conn
            .query_row(
                "SELECT MIN(block_number), MAX(block_number) FROM blocks",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));

        if max_block == 0 {
            return Ok(AllTimeChartData {
                labels: Vec::new(),
                blobs: Vec::new(),
                gas_prices: Vec::new(),
                timestamps: Vec::new(),
                targets: Vec::new(),
                maxes: Vec::new(),
                bpo2_block: None,
            });
        }

        let total_blocks = max_block - min_block + 1;
        let sample_interval = (total_blocks / target_points).max(1);

        // Fetch all blocks (we'll aggregate in memory for smoothing)
        let mut stmt = conn.prepare(
            "SELECT block_number, block_timestamp, total_blobs, gas_price
             FROM blocks
             ORDER BY block_number ASC",
        )?;

        let rows: Vec<(u64, u64, u64, u64)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Find BPO2 block
        let bpo2_block = rows
            .iter()
            .find(|(_, ts, _, _)| *ts >= bpo2_timestamp)
            .map(|(bn, _, _, _)| *bn);

        // Sample and smooth the data
        let mut labels = Vec::new();
        let mut blobs = Vec::new();
        let mut gas_prices = Vec::new();
        let mut timestamps = Vec::new();
        let mut targets = Vec::new();
        let mut maxes = Vec::new();

        let mut i = 0;
        while i < rows.len() {
            let end = (i + sample_interval as usize).min(rows.len());
            let chunk = &rows[i..end];

            if !chunk.is_empty() {
                // Take the middle block as representative
                let mid = chunk.len() / 2;
                let (block_num, timestamp, _, _) = chunk[mid];

                // Average the blobs and gas prices in this window
                let avg_blobs: f64 =
                    chunk.iter().map(|(_, _, b, _)| *b as f64).sum::<f64>() / chunk.len() as f64;
                let avg_gas_price: f64 = chunk
                    .iter()
                    .map(|(_, _, _, g)| *g as f64 / 1e9)
                    .sum::<f64>()
                    / chunk.len() as f64;

                // Determine target/max based on timestamp
                let (target, max) = if timestamp >= bpo2_timestamp {
                    (BPO2_TARGET, BPO2_MAX)
                } else {
                    (BPO1_TARGET, BPO1_MAX)
                };

                labels.push(block_num);
                blobs.push(avg_blobs);
                gas_prices.push(avg_gas_price);
                timestamps.push(timestamp);
                targets.push(target);
                maxes.push(max);
            }

            i = end;
        }

        Ok(AllTimeChartData {
            labels,
            blobs,
            gas_prices,
            timestamps,
            targets,
            maxes,
            bpo2_block,
        })
    }

    /// Get transactions in a time range (for chain profiles).
    pub fn get_transactions_in_time_range(
        &self,
        time_limit: i64,
    ) -> eyre::Result<Vec<(String, u64, i64, u64)>> {
        let conn = self.connection();

        let mut stmt = conn.prepare(
            "SELECT sender, blob_count, created_at, gas_price
             FROM blob_transactions
             WHERE created_at >= ?
             ORDER BY sender, created_at",
        )?;

        let rows: Vec<(String, u64, i64, u64)> = stmt
            .query_map([time_limit], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }
}

/// Raw statistics from the database.
#[derive(Debug)]
pub struct Stats {
    pub total_blocks: u64,
    pub total_blobs: u64,
    pub total_transactions: u64,
    pub avg_blobs_per_block: f64,
    pub latest_block: Option<u64>,
    pub earliest_block: Option<u64>,
    pub latest_gas_price: u64,
}

/// Raw block data from the database.
#[derive(Debug)]
pub struct BlockData {
    pub block_number: u64,
    pub block_timestamp: u64,
    pub tx_count: u64,
    pub total_blobs: u64,
    pub gas_used: u64,
    pub gas_price: u64,
    pub excess_blob_gas: u64,
    pub transactions: Vec<TransactionData>,
}

/// Raw transaction data from the database.
#[derive(Debug)]
pub struct TransactionData {
    pub tx_hash: String,
    pub sender: String,
    pub blob_count: u64,
}

/// Raw sender data from the database.
#[derive(Debug)]
pub struct SenderData {
    pub address: String,
    pub tx_count: u64,
    pub total_blobs: u64,
}

/// Chart data for visualization.
#[derive(Debug)]
pub struct ChartData {
    pub labels: Vec<u64>,
    pub blobs: Vec<u64>,
    pub gas_prices: Vec<f64>,
}

/// All-time chart data with smoothing.
#[derive(Debug)]
pub struct AllTimeChartData {
    pub labels: Vec<u64>,
    pub blobs: Vec<f64>,
    pub gas_prices: Vec<f64>,
    pub timestamps: Vec<u64>,
    pub targets: Vec<u64>, // Dynamic target at each point
    pub maxes: Vec<u64>,   // Dynamic max at each point
    pub bpo2_block: Option<u64>,
}

/// Blob transaction data with hashes.
#[derive(Debug)]
pub struct BlobTransactionData {
    pub tx_hash: String,
    pub block_number: u64,
    pub sender: String,
    pub blob_count: u64,
    pub gas_price: u64,
    pub blob_hashes: Vec<String>,
}
