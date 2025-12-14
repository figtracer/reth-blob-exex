import { useState, useEffect, lazy, Suspense } from "react";
import Header from "./components/Header";
import StatsGrid from "./components/StatsGrid";
import TablesSection from "./components/TablesSection";
import BlockModal from "./components/BlockModal";

// Lazy load charts to improve initial load time
const ChartsSection = lazy(() => import("./components/ChartsSection"));

function App() {
  const [stats, setStats] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [senders, setSenders] = useState([]);
  const [chartData, setChartData] = useState(null);
  const [chainStats, setChainStats] = useState([]);
  const [blobTransactions, setBlobTransactions] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [selectedBlocks, setSelectedBlocks] = useState(100);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all data
  const fetchData = async () => {
    try {
      const [statsRes, blocksRes, sendersRes, chartRes, chainRes, txsRes] =
        await Promise.all([
          fetch("/api/stats"),
          fetch("/api/blocks"),
          fetch("/api/senders"),
          fetch(`/api/chart?blocks=${selectedBlocks}`),
          fetch("/api/chain-stats"),
          fetch("/api/blob-transactions"),
        ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (blocksRes.ok) setBlocks(await blocksRes.json());
      if (sendersRes.ok) setSenders(await sendersRes.json());
      if (chartRes.ok) setChartData(await chartRes.json());
      if (chainRes.ok) setChainStats(await chainRes.json());
      if (txsRes.ok) setBlobTransactions(await txsRes.json());

      setLastUpdate(new Date());
      setIsLoading(false);
    } catch (error) {
      console.error("Error fetching data:", error);
      setIsLoading(false);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, [selectedBlocks]);

  // Search for a block
  const handleBlockSearch = async (blockNumber) => {
    try {
      const res = await fetch(`/api/block?block_number=${blockNumber}`);
      if (res.ok) {
        const block = await res.json();
        setSelectedBlock(block);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Error searching block:", error);
      throw error;
    }
  };

  return (
    <div className="app">
      <Header
        onSearch={handleBlockSearch}
        selectedBlocks={selectedBlocks}
        onBlocksChange={setSelectedBlocks}
        lastUpdate={lastUpdate}
        stats={stats}
      />

      <main className="main-content">
        {isLoading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading data...</p>
          </div>
        ) : (
          <>
            <StatsGrid stats={stats} />
            <Suspense fallback={<ChartsSkeleton />}>
              <ChartsSection
                chartData={chartData}
                chainStats={chainStats}
                onBlockClick={setSelectedBlock}
              />
            </Suspense>
            <TablesSection
              blocks={blocks}
              senders={senders}
              blobTransactions={blobTransactions}
              onBlockClick={setSelectedBlock}
            />
          </>
        )}
      </main>

      {selectedBlock && (
        <BlockModal
          block={selectedBlock}
          onClose={() => setSelectedBlock(null)}
        />
      )}

      <style jsx>{`
        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .main-content {
          flex: 1;
          max-width: 1600px;
          width: 100%;
          margin: 0 auto;
          padding: 2rem;
        }

        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 60vh;
          gap: 1rem;
          color: var(--text-secondary);
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--border-accent);
          border-top-color: var(--accent-purple);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @media (max-width: 768px) {
          .main-content {
            padding: 1rem;
          }
        }
      `}</style>
    </div>
  );
}

// Skeleton component for charts loading state
function ChartsSkeleton() {
  return (
    <div className="charts-skeleton">
      <div className="charts-grid">
        <div className="chart-card skeleton">
          <div className="skeleton-title"></div>
          <div className="skeleton-chart"></div>
        </div>
        <div className="chart-card skeleton">
          <div className="skeleton-title"></div>
          <div className="skeleton-chart"></div>
        </div>
      </div>
      <div className="chart-card skeleton" style={{ marginTop: "1rem" }}>
        <div className="skeleton-title"></div>
        <div className="skeleton-chart"></div>
      </div>
      <style jsx>{`
        .charts-skeleton {
          margin-bottom: 2rem;
        }
        .charts-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
          margin-bottom: 1rem;
        }
        .chart-card {
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          overflow: hidden;
        }
        .skeleton {
          animation: pulse 2s infinite;
        }
        .skeleton-title {
          height: 16px;
          background: var(--border-primary);
          border-radius: 4px;
          width: 150px;
          margin: 1rem 1.25rem;
        }
        .skeleton-chart {
          height: 220px;
          background: var(--border-primary);
          margin: 1rem;
          border-radius: 8px;
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        @media (max-width: 1024px) {
          .charts-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

export default App;
