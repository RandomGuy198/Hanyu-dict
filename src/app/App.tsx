import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './Shell';
import { ErrorBoundary } from './ErrorBoundary';
import {
  DictionaryProvider,
  PreferencesProvider,
  SavedWordsProvider,
  ToastProvider,
} from './providers';

/* Each module is its own chunk so the first paint stays small on a phone. */
const HomePage = lazy(() => import('../modules/dictionary/HomePage'));
const SearchPage = lazy(() => import('../modules/dictionary/SearchPage'));
const EntryPage = lazy(() => import('../modules/dictionary/EntryPage'));
const CharacterPage = lazy(() => import('../modules/characters/CharacterPage'));
const WritingPage = lazy(() => import('../modules/characters/WritingPage'));
const LibraryPage = lazy(() => import('../modules/library/LibraryPage'));
const ListPage = lazy(() => import('../modules/library/ListPage'));
const NotebookPage = lazy(() => import('../modules/library/NotebookPage'));
const PracticePage = lazy(() => import('../modules/learning/PracticePage'));
const FlashcardsPage = lazy(() => import('../modules/learning/FlashcardsPage'));
const TestListPage = lazy(() => import('../modules/learning/TestListPage'));
const TestPage = lazy(() => import('../modules/learning/TestPage'));
const ProgressPage = lazy(() => import('../modules/learning/ProgressPage'));
const ReaderPage = lazy(() => import('../modules/reading/ReaderPage'));
const ContentPage = lazy(() => import('../modules/content/ContentPage'));
const BooksHomePage = lazy(() => import('../modules/books/BooksHomePage'));
const BookReaderPage = lazy(() => import('../modules/books/BookReaderPage'));
const LessonCoursePage = lazy(() => import('../modules/books/LessonCoursePage'));
const SettingsPage = lazy(() => import('../modules/profile/SettingsPage'));
const DataPage = lazy(() => import('../modules/profile/DataPage'));
const AboutPage = lazy(() => import('../modules/profile/AboutPage'));

function PageFallback() {
  return (
    <div className="stack" role="status" aria-live="polite">
      <div className="skeleton" style={{ height: 24, width: '40%' }} />
      <div className="skeleton" style={{ height: 60 }} />
      <div className="skeleton" style={{ height: 60 }} />
    </div>
  );
}

function NotFound() {
  return (
    <div className="stack">
      <h1>That page does not exist</h1>
      <p className="muted">
        The address may be from an older version of the app, or a link typed by hand.
      </p>
      <a className="btn btn-primary" href="#/">
        Back to the dictionary
      </a>
    </div>
  );
}

export default function App({ children }: { children?: ReactNode }) {
  return (
    <PreferencesProvider>
      <ToastProvider>
        <DictionaryProvider>
          <SavedWordsProvider>
            <HashRouter>
              <ErrorBoundary>
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                    <Route element={<Shell />}>
                      <Route index element={<HomePage />} />
                      <Route path="search" element={<SearchPage />} />
                      <Route path="entry/:key" element={<EntryPage />} />
                      <Route path="character/:value" element={<CharacterPage />} />
                      <Route path="books" element={<BooksHomePage />} />
                      <Route path="books/:bookId" element={<BookReaderPage />} />
                      <Route path="books/:bookId/page/:pageNum" element={<BookReaderPage />} />
                      <Route path="courses/:bookId/:lessonId" element={<LessonCoursePage />} />
                      <Route path="study" element={<PracticePage />} />
                      <Route path="writing" element={<WritingPage />} />
                      <Route path="library" element={<LibraryPage />} />
                      <Route path="list/:id" element={<ListPage />} />
                      <Route path="notebook/:id" element={<NotebookPage />} />
                      <Route path="practice" element={<Navigate to="/study" replace />} />
                      <Route path="flashcards" element={<FlashcardsPage />} />
                      <Route path="test" element={<TestListPage />} />
                      <Route path="test/:id" element={<TestPage />} />
                      <Route path="progress" element={<ProgressPage />} />
                      {/* Removed features keep their bookmarks alive (D-24). */}
                      <Route path="capture" element={<Navigate to="/reader" replace />} />
                      <Route path="offline-data" element={<Navigate to="/settings" replace />} />
                      <Route path="learn" element={<Navigate to="/books" replace />} />
                      <Route path="learn/:id" element={<ContentPage />} />
                      <Route path="reader" element={<ReaderPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                      <Route path="data" element={<DataPage />} />
                      <Route path="about" element={<AboutPage />} />
                      <Route path="licenses" element={<AboutPage />} />
                      <Route path="home" element={<Navigate to="/" replace />} />
                      <Route path="*" element={<NotFound />} />
                    </Route>
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </HashRouter>
          </SavedWordsProvider>
        </DictionaryProvider>
      </ToastProvider>
      {children}
    </PreferencesProvider>
  );
}
