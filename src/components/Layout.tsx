import {
  ArrowUp,
  ChevronLeft,
  Clock,
  Menu,
  Search,
  Settings,
  X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

export const Layout: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("scroll", handleScroll);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
      setIsMenuOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col font-sans relative">
      {/* Grid Background */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-size-[24px_24px]"></div>

      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header - Added data-tauri-drag-region for frameless window dragging */}
        <header
          className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50 select-none"
          data-tauri-drag-region
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pointer-events-none">
            <div className="flex items-center justify-between h-16 pointer-events-auto">
              <div
                className="flex items-center gap-4 w-24"
                data-tauri-drag-region="false"
              >
                {location.pathname !== "/" && (
                  <button
                    onClick={() => navigate(-1)}
                    className="p-2 -ml-2 text-zinc-400 hover:text-white transition-colors rounded-full hover:bg-zinc-800"
                    title="Go Back"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}
                <a href="/">
                  <img src="/favicon-32x32.png" />
                </a>
              </div>

              {/* Desktop Search */}
              <div
                className="hidden md:flex flex-1 max-w-md mx-8"
                data-tauri-drag-region="false"
              >
                <form onSubmit={handleSearch} className="w-full relative group">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search movies, TV shows... (Cmd+K)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800/50 rounded-full py-2 pl-4 pr-10 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-white select-text"
                  />
                  <button
                    type="submit"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </form>
              </div>

              <div
                className="flex items-center gap-4"
                data-tauri-drag-region="false"
              >
                <Link
                  to="/history"
                  className={`p-2 transition-colors rounded-full hover:bg-zinc-800 ${location.pathname === "/history" ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-400 hover:text-white"}`}
                  title="Watch History"
                >
                  <Clock className="w-5 h-5" />
                </Link>
                <Link
                  to="/settings"
                  className={`p-2 transition-colors rounded-full hover:bg-zinc-800 ${location.pathname === "/settings" ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-400 hover:text-white"}`}
                  title="Settings"
                >
                  <Settings className="w-5 h-5" />
                </Link>
                <button
                  className="md:hidden p-2 text-zinc-400 hover:text-white"
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                >
                  {isMenuOpen ? (
                    <X className="w-6 h-6" />
                  ) : (
                    <Menu className="w-6 h-6" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Menu */}
          {isMenuOpen && (
            <div className="md:hidden border-t border-zinc-800/50 bg-zinc-950 p-4">
              <form onSubmit={handleSearch} className="relative mb-4">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800/50 rounded-lg py-3 pl-4 pr-10 text-sm focus:outline-none focus:border-indigo-500 text-white"
                />
                <button
                  type="submit"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400"
                >
                  <Search className="w-5 h-5" />
                </button>
              </form>
            </div>
          )}
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 select-none">
          <Outlet />
        </main>

        {/* Back to Top Button */}
        <button
          onClick={scrollToTop}
          className={`fixed bottom-8 right-8 z-50 p-3 rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-600 transition-all duration-300 ${
            showBackToTop
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-10 pointer-events-none"
          }`}
          aria-label="Back to top"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
