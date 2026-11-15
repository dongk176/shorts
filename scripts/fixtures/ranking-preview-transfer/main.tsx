import {createRoot} from 'react-dom/client';
import {RankingStudio} from 'ranking-studio';
import '@/app/globals.css';
import '@/app/ranking-shorts/ranking-shorts.css';
import '@/app/ranking-shorts/ranking-editor-ui.css';
import '@/app/ranking-shorts/ranking-framing.css';
import '@/app/ranking-shorts/ranking-examples.css';
import '@/app/ranking-shorts/ranking-popular-picker.css';
createRoot(document.getElementById('root')!).render(<RankingStudio refreshedDesign ownerId="local-transfer-benchmark" />);
