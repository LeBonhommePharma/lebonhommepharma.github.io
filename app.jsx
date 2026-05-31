// Le Bonhomme Pharma — root composition.

function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <div className="section-divider" />
        <Manifesto />
        <Work />
        <div className="section-divider" />
        <Principles />
        <Place />
        <Connect />
      </main>
      <Footer />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
