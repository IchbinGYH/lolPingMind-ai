import { createRoot } from 'react-dom/client';
import { QuestionApp } from './QuestionApp';
import './question.css';

createRoot(document.getElementById('root') as HTMLElement).render(<QuestionApp />);
