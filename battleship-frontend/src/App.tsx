import { Layout } from './components/Layout';
import { BattleshipGame } from './games/battleship/BattleshipGame';

const GAME_TITLE = 'Battleship';
const GAME_TAGLINE = 'Classic mode';

export default function App() {
  return (
    <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      <BattleshipGame />
    </Layout>
  );
}
