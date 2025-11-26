import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  updateProfile,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  onSnapshot
} from 'firebase/firestore';
import { 
  Trophy, 
  Calendar, 
  User, 
  LogOut, 
  Activity, 
  AlertCircle,
  TrendingUp,
  RefreshCw,
  Globe2,
  Sparkles,
  ChevronRight,
  Filter,
  Layers,
  Clock
} from 'lucide-react';

// --- Cấu hình Firebase & Khởi tạo ---
// Đã cập nhật với thông tin dự án của bạn
const firebaseConfig = {
  apiKey: "AIzaSyBbl9HqfKTW80w3LqIwmJ_X1MZ4778F8CQ",
  authDomain: "football-du-doan.firebaseapp.com",
  projectId: "football-du-doan",
  storageBucket: "football-du-doan.firebasestorage.app",
  messagingSenderId: "660858494108",
  appId: "1:660858494108:web:c08c684fb35100fa7ae159",
  measurementId: "G-VXDW1W6LBG"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// ID định danh cho ứng dụng (dùng để tạo folder trong database)
const appId = 'football-du-doan';

// --- Types ---
type MatchStatus = 'scheduled' | 'finished' | 'live';

interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number | null; 
  awayScore?: number | null;
  homeLogo?: string;
  awayLogo?: string;
  startTime: string; // ISO string
  league: string;
  status: MatchStatus;
}

interface Prediction {
  matchId: string;
  homeScore: number;
  awayScore: number;
  points?: number;
}

interface UserProfile {
  uid: string;
  displayName: string;
  totalPoints: number;
}

// --- API CONFIG (Cập nhật thêm giải Châu Á) ---
const API_ENDPOINTS = [
  // Châu Âu
  { name: 'Premier League', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard' },
  { name: 'La Liga', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard' },
  { name: 'Champions League', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard' },
  { name: 'Bundesliga', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard' },
  { name: 'Serie A', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1/scoreboard' },
  // Châu Á & Khác
  { name: 'AFC CL Elite', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/afc.champions/scoreboard' }, 
  { name: 'AFC CL Two', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/afc.cup/scoreboard' }, 
  { name: 'V-League', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/vnm.1/scoreboard' },
  { name: 'Saudi Pro League', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/sau.1/scoreboard' },
  { name: 'J1 League', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/jpn.1/scoreboard' },
  { name: 'K League 1', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/kor.1/scoreboard' },
];

// --- Helper Date ---
// Hàm lấy chuỗi YYYYMMDD cho n ngày tới
const getNextDates = (daysToCheck: number) => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < daysToCheck; i++) {
        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + i);
        const yyyy = nextDate.getFullYear();
        const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
        const dd = String(nextDate.getDate()).padStart(2, '0');
        dates.push(`${yyyy}${mm}${dd}`);
    }
    return dates;
};

// --- REAL DATA FETCHER (ESPN - Multi-day) ---
const fetchRealMatchesFromESPN = async (): Promise<Match[]> => {
  const allMatches: Match[] = [];
  const datesToCheck = getNextDates(3); // Lấy dữ liệu 3 ngày: Hôm nay, Mai, Kia

  try {
    // Tạo danh sách tất cả các request cần gọi (Số giải x Số ngày)
    const fetchPromises = [];
    
    for (const league of API_ENDPOINTS) {
        for (const dateStr of datesToCheck) {
            fetchPromises.push(
                fetch(`${league.url}?dates=${dateStr}`)
                    .then(res => res.json())
                    .then(data => ({ leagueName: league.name, data }))
                    .catch(err => null)
            );
        }
    }

    const results = await Promise.all(fetchPromises);

    results.forEach((res: any) => {
        if (!res || !res.data || !res.data.events) return;

        res.data.events.forEach((event: any) => {
          const competition = event.competitions[0];
          const competitors = competition.competitors;
          const homeComp = competitors.find((c: any) => c.homeAway === 'home');
          const awayComp = competitors.find((c: any) => c.homeAway === 'away');
          const statusState = event.status.type.state;

          // Map status
          let status: MatchStatus = 'scheduled';
          if (statusState === 'in') status = 'live';
          else if (statusState === 'post') status = 'finished';

          // Chỉ lấy nếu có đủ thông tin
          if (homeComp && awayComp) {
              allMatches.push({
                id: event.id,
                league: res.leagueName,
                startTime: event.date,
                status: status,
                homeTeam: homeComp.team.displayName,
                homeScore: status === 'scheduled' ? null : (parseInt(homeComp.score) || 0),
                homeLogo: homeComp.team.logo,
                awayTeam: awayComp.team.displayName,
                awayScore: status === 'scheduled' ? null : (parseInt(awayComp.score) || 0),
                awayLogo: awayComp.team.logo
              });
          }
        });
    });

    // Khử trùng lặp (Deduplicate) dựa trên ID trận đấu
    const uniqueMatches = Array.from(new Map(allMatches.map(item => [item.id, item])).values());
    return uniqueMatches;

  } catch (error) {
    console.error("Global fetch error", error);
    return [];
  }
};

// --- LOGO HELPER (Fallback) ---
const getTeamLogo = (teamName: string, apiLogo?: string) => {
  if (apiLogo) return apiLogo;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(teamName)}&background=random&color=10b981&size=64&font-size=0.4`;
};

// --- Helper Functions ---
const calculatePoints = (pred: Prediction, match: Match): number => {
  if (match.status !== 'finished' || match.homeScore == null || match.awayScore == null) return 0;
  
  const pHome = Number(pred.homeScore);
  const pAway = Number(pred.awayScore);
  const aHome = Number(match.homeScore);
  const aAway = Number(match.awayScore);

  if (pHome === aHome && pAway === aAway) return 2;

  const pResult = pHome > pAway ? 'H' : pHome < pAway ? 'A' : 'D';
  const aResult = aHome > aAway ? 'H' : aHome < aAway ? 'A' : 'D';

  if (pResult === aResult) return 1;

  return 0;
};

// --- Component Chính ---
export default function FootballPredictionApp() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({});
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [activeTab, setActiveTab] = useState<'matches' | 'leaderboard' | 'profile'>('matches');
  const [loginName, setLoginName] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<string>('all'); 

  // Inject Font
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  // 1. Khởi tạo Auth
  useEffect(() => {
    const initAuth = async () => {
        // Với Firebase thật, chỉ cần signInAnonymously là đủ, không cần token custom
        await signInAnonymously(auth);
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Refresh Data
  const refreshMatches = async () => {
    if (!user) return;
    setIsRefreshing(true);
    const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
    
    // Fetch dữ liệu mới nhất (3 ngày)
    const realMatches = await fetchRealMatchesFromESPN();
    
    if (realMatches.length > 0) {
      for (const match of realMatches) {
          const safeMatchData = JSON.parse(JSON.stringify(match));
          await setDoc(doc(matchesRef, match.id), safeMatchData, { merge: true });
      }
    }
    
    setIsRefreshing(false);
  };

  // 3. Listen Matches
  useEffect(() => {
    if (!user) return;

    const matchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'matches');
    
    // Load lần đầu nếu chưa có data
    const seedDataIfNeeded = async () => {
      const snap = await getDocs(matchesRef);
      if (snap.empty) {
        await refreshMatches();
      }
    };
    seedDataIfNeeded();

    const unsubscribe = onSnapshot(matchesRef, (snapshot) => {
      const matchesList = snapshot.docs.map(d => d.data() as Match);
      // Sort: Live -> Time
      matchesList.sort((a, b) => {
        if (a.status === 'live' && b.status !== 'live') return -1;
        if (b.status === 'live' && a.status !== 'live') return 1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
      setMatches(matchesList);
    }, (error) => console.error(error));

    return () => unsubscribe();
  }, [user]);

  // 4. Listen Predictions
  useEffect(() => {
    if (!user) return;
    const predictionsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'predictions');
    const unsubscribe = onSnapshot(predictionsRef, (snapshot) => {
      const preds: Record<string, Prediction> = {};
      snapshot.docs.forEach(doc => {
        preds[doc.data().matchId] = doc.data() as Prediction;
      });
      setPredictions(preds);
    }, (error) => console.error(error));
    return () => unsubscribe();
  }, [user]);

  // 5. Update Points
  useEffect(() => {
    if (!user || matches.length === 0) return;
    let total = 0;
    Object.values(predictions).forEach(pred => {
      const match = matches.find(m => m.id === pred.matchId);
      if (match && match.status === 'finished') {
        total += calculatePoints(pred, match);
      }
    });

    setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid), {
        uid: user.uid,
        displayName: user.displayName || 'Khách',
        totalPoints: total
    }, { merge: true });

  }, [user, predictions, matches]);

  // 6. Listen Leaderboard
  useEffect(() => {
    if (!user) return;
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'users');
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const users = snapshot.docs.map(d => d.data() as UserProfile);
      users.sort((a, b) => b.totalPoints - a.totalPoints);
      setLeaderboard(users);
    }, (error) => console.error(error));
    return () => unsubscribe();
  }, [user]);

  // --- Logic Nhóm & Lọc ---
  const uniqueLeagues = useMemo(() => {
    const leagues = new Set(matches.map(m => m.league));
    return Array.from(leagues).sort();
  }, [matches]);

  const groupedMatches = useMemo(() => {
    let filtered = matches;
    
    // Filter
    if (selectedLeague !== 'all') {
      filtered = matches.filter(m => m.league === selectedLeague);
    }

    // Group by League
    const groups: Record<string, Match[]> = {};
    filtered.forEach(match => {
      if (!groups[match.league]) {
        groups[match.league] = [];
      }
      groups[match.league].push(match);
    });
    
    return groups;
  }, [matches, selectedLeague]);

  // --- Handlers ---
  const handleUpdateProfile = async () => {
    if (!loginName.trim() || !user) return;
    setIsAuthLoading(true);
    try {
      await updateProfile(user, { displayName: loginName });
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid), {
          uid: user.uid,
          displayName: loginName,
          totalPoints: 0
      });
      window.location.reload();
    } catch (e) {
      console.error(e);
    } finally {
        setIsAuthLoading(false);
    }
  };

  const submitPrediction = async (matchId: string, home: string, away: string) => {
    if (!user) return;
    const h = parseInt(home);
    const a = parseInt(away);
    if (isNaN(h) || isNaN(a)) return;

    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'predictions', matchId), {
      matchId,
      homeScore: h,
      awayScore: a,
      timestamp: new Date().toISOString()
    });
  };

  // --- Render ---

  const renderLogin = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 relative overflow-hidden font-['Outfit']">
      <div className="absolute top-0 left-0 w-full h-full opacity-60 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-300/30 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-300/30 rounded-full blur-[120px]"></div>
      </div>

      <div className="bg-white/80 backdrop-blur-xl p-8 rounded-3xl shadow-2xl w-full max-w-sm border border-white/50 relative z-10 transition-all hover:scale-[1.01] duration-500">
        <div className="flex justify-center mb-8">
           <div className="relative bg-gradient-to-br from-emerald-400 to-teal-500 p-4 rounded-2xl shadow-lg shadow-emerald-200">
             <Globe2 className="w-10 h-10 text-white" />
             <div className="absolute -top-2 -right-2 w-5 h-5 bg-orange-400 rounded-full flex items-center justify-center border-2 border-white">
                <Sparkles className="w-3 h-3 text-white" />
             </div>
           </div>
        </div>
        <h1 className="text-3xl font-bold text-slate-800 text-center mb-2 tracking-tight">Chào mừng!</h1>
        <p className="text-slate-500 text-center mb-8 font-medium">Tham gia cộng đồng dự đoán bóng đá sôi động nhất.</p>
        
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 pl-1">Tên hiển thị</label>
            <input 
              type="text" 
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-semibold focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition placeholder-slate-400"
              placeholder="VD: Tuấn Tiền Tỉ..."
            />
          </div>
          <button 
            onClick={handleUpdateProfile}
            disabled={isAuthLoading || !loginName}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 text-white font-bold py-4 rounded-2xl transition shadow-xl shadow-emerald-500/20 flex justify-center items-center gap-2 text-lg"
          >
            {isAuthLoading ? <Activity className="animate-spin w-6 h-6" /> : 'Bắt đầu ngay'} <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );

  const renderMatchCard = (match: Match) => {
    const pred = predictions[match.id];
    const isFinished = match.status === 'finished';
    const pointsEarned = isFinished && pred ? calculatePoints(pred, match) : null;
    const matchTime = new Date(match.startTime);
    const isToday = new Date().toDateString() === matchTime.toDateString();
    
    // Format ngày ngắn gọn
    const dateDisplay = matchTime.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric'});
    const timeDisplay = matchTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute:'2-digit'});

    return (
      <div key={match.id} className="bg-white rounded-2xl overflow-hidden mb-3 shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-slate-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 group">
        {/* Match Header Info */}
        <div className="bg-slate-50/50 px-4 py-2 flex justify-between items-center text-[10px] font-bold border-b border-slate-100/50">
          <div className="flex items-center gap-2">
             {match.status === 'live' ? (
               <span className="flex items-center gap-1 text-rose-500 animate-pulse">
                 <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span> LIVE
               </span>
             ) : (
                <span className={`${isToday ? 'text-emerald-600 flex items-center gap-1' : 'text-slate-400 flex items-center gap-1'}`}>
                   {isToday ? 'Hôm nay' : dateDisplay} • <Clock className="w-3 h-3" /> {timeDisplay}
                </span>
             )}
          </div>
          {match.status === 'finished' && <span className="text-slate-400">FT</span>}
        </div>

        {/* Teams & Scores */}
        <div className="p-4">
          <div className="flex items-center justify-between gap-4">
             {/* Home */}
             <div className="flex-1 flex flex-col items-center gap-2">
                 <div className="w-12 h-12 relative">
                    <img src={getTeamLogo(match.homeTeam, match.homeLogo)} alt={match.homeTeam} className="w-full h-full object-contain drop-shadow-sm" />
                 </div>
                 <div className="text-center">
                    <div className="font-bold text-slate-800 text-sm leading-tight line-clamp-2">{match.homeTeam}</div>
                 </div>
             </div>
             
             {/* Score Area */}
             <div className="flex flex-col items-center justify-center min-w-[80px]">
                {isFinished || match.status === 'live' ? (
                   <div className={`text-2xl font-black tracking-tight px-3 py-1 rounded-xl ${match.status === 'live' ? 'text-rose-500' : 'text-slate-800'}`}>
                      {match.homeScore}-{match.awayScore}
                   </div>
                ) : (
                    <div className="text-slate-200 font-black text-xl">VS</div>
                )}
             </div>

             {/* Away */}
             <div className="flex-1 flex flex-col items-center gap-2">
                 <div className="w-12 h-12 relative">
                    <img src={getTeamLogo(match.awayTeam, match.awayLogo)} alt={match.awayTeam} className="w-full h-full object-contain drop-shadow-sm" />
                 </div>
                 <div className="text-center">
                    <div className="font-bold text-slate-800 text-sm leading-tight line-clamp-2">{match.awayTeam}</div>
                 </div>
             </div>
          </div>

          {/* Prediction Input */}
          <div className={`mt-4 rounded-xl p-1 transition-all duration-300 ${pointsEarned === 2 ? 'bg-gradient-to-r from-emerald-400 to-teal-400 shadow-md shadow-emerald-200' : 'bg-slate-50'}`}>
             <div className="bg-white rounded-lg p-2 shadow-sm flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">
                    Dự đoán
                </span>
                
                <div className="flex items-center gap-2">
                  {isFinished ? (
                    <div className="flex items-center gap-1 font-mono font-bold text-slate-800">
                         <span>{pred ? pred.homeScore : '-'}</span>:<span>{pred ? pred.awayScore : '-'}</span>
                         {pointsEarned !== null && pointsEarned > 0 && (
                             <span className={`text-[10px] ml-1 px-1.5 py-0.5 rounded ${pointsEarned === 2 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>+{pointsEarned}</span>
                         )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                        <input 
                            type="number" 
                            min="0"
                            placeholder="?"
                            defaultValue={pred?.homeScore}
                            onBlur={(e) => submitPrediction(match.id, e.target.value, (document.getElementById(`away-${match.id}`) as HTMLInputElement).value)}
                            id={`home-${match.id}`}
                            className="w-8 h-8 text-center bg-slate-50 border border-slate-200 rounded text-slate-800 font-bold text-sm focus:border-emerald-500 focus:bg-white outline-none"
                        />
                        <span className="text-slate-300 font-bold text-xs">-</span>
                        <input 
                            type="number" 
                            min="0"
                            placeholder="?"
                            defaultValue={pred?.awayScore}
                            onBlur={(e) => submitPrediction(match.id, (document.getElementById(`home-${match.id}`) as HTMLInputElement).value, e.target.value)}
                            id={`away-${match.id}`}
                            className="w-8 h-8 text-center bg-slate-50 border border-slate-200 rounded text-slate-800 font-bold text-sm focus:border-emerald-500 focus:bg-white outline-none"
                        />
                    </div>
                  )}
                </div>
             </div>
          </div>
        </div>
      </div>
    );
  };

  const renderLeaderboard = () => (
    <div className="space-y-6">
        <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl p-6 text-white shadow-xl shadow-orange-200 relative overflow-hidden">
            <div className="relative z-10">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Trophy className="w-7 h-7" /> Bảng Vàng
                </h2>
                <p className="text-white/90 text-sm mt-1 font-medium">Top những nhà tiên tri tài ba nhất mùa giải</p>
            </div>
            <Trophy className="absolute -bottom-6 -right-6 w-40 h-40 text-white/20 rotate-12" />
        </div>

        <div className="bg-white rounded-3xl overflow-hidden border border-slate-100 shadow-lg shadow-slate-200/50">
            {leaderboard.map((u, idx) => (
                <div key={u.uid} className={`flex items-center p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50/80 transition ${u.uid === user.uid ? 'bg-emerald-50/50' : ''}`}>
                    <div className="w-12 flex justify-center">
                        {idx === 0 ? <span className="text-3xl drop-shadow-sm">🥇</span> : 
                         idx === 1 ? <span className="text-3xl drop-shadow-sm">🥈</span> : 
                         idx === 2 ? <span className="text-3xl drop-shadow-sm">🥉</span> : 
                         <span className="font-bold text-slate-400 text-lg">#{idx + 1}</span>}
                    </div>
                    <div className="flex-1 ml-3">
                        <div className="flex items-center gap-2">
                            <span className={`font-bold text-base ${u.uid === user.uid ? 'text-emerald-600' : 'text-slate-800'}`}>
                                {u.displayName}
                            </span>
                            {u.uid === user.uid && <span className="text-[10px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-bold">Tôi</span>}
                        </div>
                        <div className="text-xs text-slate-400 font-medium">Thành viên</div>
                    </div>
                    <div className="text-right pr-2">
                        <div className="font-['Outfit'] font-bold text-xl text-slate-800 leading-none">
                            {u.totalPoints}
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold mt-1">ĐIỂM</div>
                    </div>
                </div>
            ))}
            {leaderboard.length === 0 && (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center">
                    <Activity className="w-10 h-10 mb-3 opacity-30" />
                    Chưa có dữ liệu xếp hạng
                </div>
            )}
        </div>
    </div>
  );

  const renderProfile = () => {
    const finishedPreds = Object.values(predictions).filter(p => {
        const m = matches.find(match => match.id === p.matchId);
        return m?.status === 'finished';
    });
    
    const myTotalPoints = finishedPreds.reduce((acc, pred) => {
        const m = matches.find(match => match.id === pred.matchId);
        if(m) return acc + calculatePoints(pred, m);
        return acc;
    }, 0);

    const exactCorrect = finishedPreds.filter(p => {
        const m = matches.find(match => match.id === p.matchId);
        if(!m) return false;
        return calculatePoints(p, m) === 2;
    }).length;

    return (
      <div className="space-y-6">
         <div className="bg-white rounded-3xl p-8 border border-slate-100 text-center shadow-xl shadow-slate-200/50 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 to-teal-500"></div>
            <div className="w-24 h-24 bg-gradient-to-br from-emerald-100 to-teal-50 rounded-full mx-auto flex items-center justify-center mb-4 shadow-inner">
                <User className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-1">{user.displayName}</h2>
            <div className="text-slate-400 text-xs bg-slate-50 inline-block px-3 py-1 rounded-full font-mono">ID: {user.uid.slice(0,8)}</div>
            
            <div className="grid grid-cols-2 gap-4 mt-8">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <div className="text-3xl font-black text-slate-800 mb-1">{myTotalPoints}</div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Tổng Điểm</div>
                </div>
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                    <div className="text-3xl font-black text-emerald-600 mb-1">{exactCorrect}</div>
                    <div className="text-[10px] text-emerald-600/70 font-bold uppercase tracking-wider">Trúng Phóc</div>
                </div>
            </div>
         </div>

         <button 
           onClick={() => window.location.reload()}
           className="w-full py-4 rounded-2xl bg-white border border-rose-100 text-rose-500 hover:bg-rose-50 transition flex items-center justify-center gap-2 text-sm font-bold shadow-sm"
         >
            <LogOut className="w-4 h-4" /> Đăng Xuất
         </button>
      </div>
    );
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center font-['Outfit']"><Activity className="w-10 h-10 text-emerald-500 animate-spin" /></div>;

  if (!user || !user.displayName) return renderLogin();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-['Outfit'] pb-28 selection:bg-emerald-200 selection:text-emerald-900">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-xl border-b border-slate-100 px-5 py-3 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2.5">
            <div className="bg-gradient-to-tr from-emerald-500 to-teal-400 p-2 rounded-xl shadow-lg shadow-emerald-200">
                <Globe2 className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-slate-800 tracking-tight text-xl bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">VuaDựĐoán</h1>
        </div>
        <div className="flex items-center gap-3">
             {activeTab === 'matches' && (
                <button 
                  onClick={refreshMatches} 
                  disabled={isRefreshing}
                  className="p-2.5 rounded-full bg-slate-100 hover:bg-emerald-50 text-slate-500 hover:text-emerald-600 transition shadow-sm"
                  title="Cập nhật 3 ngày tới"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-500' : ''}`} />
                </button>
             )}
            <div className="px-3 py-1.5 bg-slate-800 rounded-full text-xs font-bold text-white shadow-md flex items-center gap-1.5">
               <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
               {leaderboard.find(u => u.uid === user.uid)?.totalPoints || 0} pts
            </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto p-4 pt-6">
        {activeTab === 'matches' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* Header Section Matches */}
                <div className="flex items-center justify-between px-1">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                       <Calendar className="w-6 h-6 text-emerald-500" /> Trận Đấu
                    </h2>
                    <span className="text-[10px] font-bold text-slate-400 bg-white px-3 py-1.5 rounded-full border border-slate-100 shadow-sm">
                       {matches.length} Trận
                    </span>
                </div>

                {/* Filter Bar (Horizontal Scroll) */}
                <div className="flex overflow-x-auto gap-2 pb-2 px-1 -mx-1 scrollbar-hide">
                    <button 
                       onClick={() => setSelectedLeague('all')}
                       className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-sm border ${selectedLeague === 'all' ? 'bg-emerald-500 text-white border-emerald-500 shadow-emerald-200' : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50'}`}
                    >
                        Tất cả
                    </button>
                    {uniqueLeagues.map(league => (
                         <button 
                           key={league}
                           onClick={() => setSelectedLeague(league)}
                           className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-sm border ${selectedLeague === league ? 'bg-emerald-500 text-white border-emerald-500 shadow-emerald-200' : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50'}`}
                        >
                            {league}
                        </button>
                    ))}
                </div>
                
                {/* Match Lists (Grouped) */}
                {Object.keys(groupedMatches).length === 0 ? (
                  <div className="text-center py-16 bg-white rounded-3xl border border-slate-100 shadow-sm">
                     <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Filter className="w-8 h-8 text-slate-300" />
                     </div>
                     <p className="text-slate-500 font-medium">Không tìm thấy trận nào.</p>
                     <p className="text-xs text-slate-400 mt-2 px-8">Hãy thử nhấn nút "Cập nhật" để tải dữ liệu 3 ngày tới.</p>
                     <button onClick={refreshMatches} disabled={isRefreshing} className="mt-6 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 rounded-xl text-sm font-bold text-white transition shadow-lg shadow-emerald-200 flex items-center gap-2 mx-auto">
                        {isRefreshing ? <Activity className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Tải lại dữ liệu
                     </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                     {Object.entries(groupedMatches).map(([leagueName, leagueMatches]) => (
                        <div key={leagueName} className="space-y-3">
                             <div className="flex items-center gap-2 px-2 text-slate-800">
                                 <Layers className="w-4 h-4 text-emerald-500" />
                                 <h3 className="font-bold text-sm uppercase tracking-wide">{leagueName}</h3>
                             </div>
                             <div>
                                 {leagueMatches.map(renderMatchCard)}
                             </div>
                        </div>
                     ))}
                     <div className="text-center text-xs font-medium text-slate-400 pt-4 pb-8">
                         Hiển thị dữ liệu 3 ngày tới từ ESPN
                     </div>
                  </div>
                )}
            </div>
        )}

        {activeTab === 'leaderboard' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
               {renderLeaderboard()}
            </div>
        )}
        
        {activeTab === 'profile' && (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
               {renderProfile()}
             </div>
        )}
      </div>

      {/* Mobile Navigation */}
      <div className="fixed bottom-6 left-6 right-6 bg-white/90 backdrop-blur-xl border border-white/20 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-2xl p-2 flex justify-between items-center z-30 md:hidden">
         <button 
           onClick={() => setActiveTab('matches')}
           className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl transition-all duration-300 ${activeTab === 'matches' ? 'bg-emerald-50 text-emerald-600 shadow-inner' : 'text-slate-400 hover:text-slate-600'}`}
         >
            <Calendar className={`w-6 h-6 ${activeTab === 'matches' ? 'fill-emerald-500/20' : ''}`} />
            <span className="text-[10px] font-bold">Lịch Đấu</span>
         </button>
         
         <button 
           onClick={() => setActiveTab('leaderboard')}
           className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl transition-all duration-300 ${activeTab === 'leaderboard' ? 'bg-amber-50 text-amber-500 shadow-inner' : 'text-slate-400 hover:text-slate-600'}`}
         >
            <TrendingUp className={`w-6 h-6 ${activeTab === 'leaderboard' ? 'fill-amber-500/20' : ''}`} />
            <span className="text-[10px] font-bold">Xếp Hạng</span>
         </button>

         <button 
           onClick={() => setActiveTab('profile')}
           className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl transition-all duration-300 ${activeTab === 'profile' ? 'bg-blue-50 text-blue-500 shadow-inner' : 'text-slate-400 hover:text-slate-600'}`}
         >
            <User className={`w-6 h-6 ${activeTab === 'profile' ? 'fill-blue-500/20' : ''}`} />
            <span className="text-[10px] font-bold">Cá Nhân</span>
         </button>
      </div>

      {/* Desktop Navigation */}
      <div className="hidden md:flex fixed bottom-8 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md border border-slate-200 px-2 py-2 rounded-full shadow-2xl gap-2 z-30">
         {['matches', 'leaderboard', 'profile'].map((tab) => (
             <button 
               key={tab}
               onClick={() => setActiveTab(tab as any)}
               className={`flex items-center gap-2 px-6 py-3 rounded-full transition-all font-bold ${activeTab === tab ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
             >
                {tab === 'matches' && <Calendar className="w-4 h-4" />}
                {tab === 'leaderboard' && <Trophy className="w-4 h-4" />}
                {tab === 'profile' && <User className="w-4 h-4" />}
                <span className="capitalize">{tab === 'matches' ? 'Lịch Đấu' : tab === 'leaderboard' ? 'Bảng Xếp Hạng' : 'Cá Nhân'}</span>
             </button>
         ))}
      </div>
    </div>
  );
}