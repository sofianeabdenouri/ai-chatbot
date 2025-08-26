// Chatbot.jsx — centered 1/3 main column + New Chat + Delete Chat (×) + files under input
// History titles = smart 4-ish word summary of first user message (math-aware). No Clear button.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import '../styles/chatbot.css'; 
import { personas } from '../prompts/personas';
import { translations } from '../i18n/translations';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';             
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import Select from 'react-select';
import logo from '../assets/logo.png';

// >>>>>>>>>>>>> pdf.js worker (Vite + pdfjs v5) <<<<<<<<<<<<<
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
// <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_KEY;

const FILE_ICONS = {
  'application/pdf': '📄',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📃',
  'text/plain': '📝',
};

/** Basic, fast, client-side summarizer for titles */
function summarizeSmart(text = '') {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled';

  const lc = cleaned.toLowerCase();

  // math operators (symbols or words)
  const opMap = [
    { re: /(\d+)\s*\+\s*(\d+)/, title: (a,b) => `Sum of ${a} and ${b}` },
    { re: /(\d+)\s*-\s*(\d+)/, title: (a,b) => `Difference ${a}–${b}` },
    { re: /(\d+)\s*[×x*]\s*(\d+)/, title: (a,b) => `Product ${a}×${b}` },
    { re: /(\d+)\s*[\/÷]\s*(\d+)/, title: (a,b) => `Quotient ${a}÷${b}` },
    { re: /(\d+)\s*(plus)\s*(\d+)/, title: (a,_,b) => `Sum of ${a} and ${b}` },
    { re: /(\d+)\s*(minus)\s*(\d+)/, title: (a,_,b) => `Difference ${a}–${b}` },
    { re: /(\d+)\s*(times|multiplied by)\s*(\d+)/, title: (a,_,b) => `Product ${a}×${b}` },
    { re: /(\d+)\s*(divided by)\s*(\d+)/, title: (a,_,b) => `Quotient ${a}÷${b}` },
  ];
  for (const rule of opMap) {
    const m = lc.match(rule.re);
    if (m) return rule.title(m[1], m[2], m[3]).trim();
  }

  // common intents
  if (/^what('?| i)s/.test(lc)) return cleaned.replace(/^what('?| i)s\s+/i, 'What is ').split('?')[0].slice(0, 48);
  if (/^how to\b/.test(lc)) return cleaned.replace(/^how to/i, 'How to').split(/[?.]/)[0].slice(0, 48);
  if (/^explain\b/.test(lc)) return cleaned.split(/[?.]/)[0].replace(/^explain/i, 'Explain').slice(0, 48);
  if (/^summarize\b/.test(lc)) return 'Summary request';

  // simple keywordy fallback (max 4 words)
  const stop = new Set(['the','a','an','and','or','of','to','in','on','for','with','is','are','be','do','does','what','whats','how','why','can','i','you','me','my','your']);
  const words = cleaned
    .replace(/[^\w\s+-/×÷]/g, '')
    .split(/\s+/)
    .filter(w => !stop.has(w.toLowerCase()));
  const title = words.slice(0, 4).join(' ');
  return title || 'Untitled';
}

function Chatbot() {
  const [selectedPersona, setSelectedPersona] = useState('pragmaticCoach');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('fr');
  const [voices, setVoices] = useState([]);
  const [muted, setMuted] = useState(() => localStorage.getItem('chatbot_muted') === 'true');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('chatbot_darkmode') !== 'false');
  const [partialResponse, setPartialResponse] = useState('');
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [sessionList, setSessionList] = useState([]); // array of ids
  const [fileError, setFileError] = useState('');
  const [historyCollapsed, setHistoryCollapsed] = useState(false); // 👈 NEW: collapse toggle
  const [isDragging, setIsDragging] = useState(false);
const personaOptions = Object.keys(personas).map(key => ({
  value: key,
  label: personas[key].name[language] || key
}));


  const bottomRef = useRef(null);
  const t = useMemo(() => translations[language], [language]);
  const customPrompt = useMemo(
    () => personas[selectedPersona]?.prompt?.[language] || '',
    [selectedPersona, language]
  );

  useEffect(() => {
document.title = t.appTitle;
    document.body.classList.remove('dark', 'light');
    document.body.classList.add(darkMode ? 'dark' : 'light');
    localStorage.setItem('chatbot_darkmode', darkMode);
  }, [darkMode]);

  // load sessions
  useEffect(() => {
    const sessions = Object.keys(localStorage)
      .filter(k => k.startsWith('chatbot_messages_'))
      .map(k => k.replace('chatbot_messages_', ''))
      .sort((a, b) => Number(b) - Number(a));
    setSessionList(sessions);
    const last = localStorage.getItem('chatbot_last_session');
    const id = last || Date.now().toString();
    setSessionId(id);
    localStorage.setItem('chatbot_last_session', id);
  }, []);

  // load messages on session/persona/lang change
  useEffect(() => {
    const saved = localStorage.getItem(`chatbot_messages_${sessionId}`);
    setMessages(saved ? JSON.parse(saved) : []);
    setInput('');
  }, [selectedPersona, language, sessionId]);

  // persist current session messages
  useEffect(() => {
    if (sessionId) localStorage.setItem(`chatbot_messages_${sessionId}`, JSON.stringify(messages));
  }, [messages, sessionId]);

  // persist mute
  useEffect(() => {
    localStorage.setItem('chatbot_muted', muted);
  }, [muted]);

  // voices
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      if (availableVoices.length) setVoices(availableVoices);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

useEffect(() => {
  let dragCounter = 0;

  const onDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter += 1;
    setIsDragging(true);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter -= 1;
    if (dragCounter <= 0) {
      setIsDragging(false);
      dragCounter = 0;
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter = 0;
    if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  document.addEventListener('dragenter', onDragEnter);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', onDrop);

  return () => {
    document.removeEventListener('dragenter', onDragEnter);
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('dragleave', onDragLeave);
    document.removeEventListener('drop', onDrop);
  };
}, []);


  // autoscroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, partialResponse]);

  const speak = (text) => {
    if (muted || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const preferredVoice = voices.find(v =>
      language === 'fr' ? v.lang.startsWith('fr') : v.lang.startsWith('en')
    );
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.lang = language === 'fr' ? 'fr-FR' : 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const newChat = () => {
    const id = Date.now().toString();
    localStorage.setItem('chatbot_last_session', id);
    setSessionId(id);
    setMessages([]);
    setUploadedFiles([]);
    setInput('');
localStorage.setItem(`chatbot_title_${id}`, t.newChatTitle);
    setSessionList(prev => [id, ...prev.filter(s => s !== id)]);
  };

  const deleteChat = (id) => {
if (!window.confirm(t.deleteConfirm)) return;
    localStorage.removeItem(`chatbot_messages_${id}`);
    localStorage.removeItem(`chatbot_title_${id}`);
    setSessionList(prev => {
      const updated = prev.filter(s => s !== id);
      if (sessionId === id) {
        const next = updated[0] || Date.now().toString();
        setSessionId(next);
        if (!updated[0]) {
          localStorage.setItem('chatbot_last_session', next);
          setMessages([]);
        }
      }
      return updated;
    });
  };

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim() && uploadedFiles.length === 0) return;

    const contextPrefix = uploadedFiles.length
  ? `${t.attachNoticeBefore} ${uploadedFiles.length} ${t.attachNoticeAfter}\n\n` +
    uploadedFiles.map(f => `${t.fileLabel} "${f.name}"\n${t.contentLabel}\n${f.content}`).join('\n\n') +
    '\n\n'
  : '';


    const userInput = input.trim();
    const fullUserMessage = contextPrefix + userInput;
    const newMessage = { role: 'user', content: fullUserMessage };

    // set a smart title for first user msg
    const firstUserCount = messages.filter(m => m.role === 'user').length;
    if (firstUserCount === 0) {
      const title = summarizeSmart(userInput);
      localStorage.setItem(`chatbot_title_${sessionId}`, title);
      setSessionList(prev => (prev.includes(sessionId) ? prev : [sessionId, ...prev]));
    }

setMessages(msgs => [
  ...msgs,
  {
    role: 'user',
    content: userInput,
    files: uploadedFiles.length ? [...uploadedFiles] : undefined
  }
]);
    setInput('');
    setUploadedFiles([]); // reset après envoi
    setLoading(true);
    setPartialResponse('');

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'system', content: customPrompt }, ...messages.slice(-10), newMessage],
          stream: true,
        }),
      });

      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));
        for (let line of lines) {
          const json = line.replace(/^data:\s*/, '');
          if (json === '[DONE]') break;
          try {
            const parsed = JSON.parse(json);
            const token = parsed.choices?.[0]?.delta?.content || '';
            fullText += token;
            setPartialResponse(fullText);
          } catch {}
        }
      }

      setPartialResponse('');
      setMessages(msgs => [...msgs, { role: 'assistant', content: fullText }]);
      speak(fullText);
    } catch (err) {
setMessages(msgs => [...msgs, { role: 'assistant', content: t.errorApi }]);
    }

    setLoading(false);
  }

  async function handleFiles(fileList) {
    const newFiles = [];
    setFileError('');

    for (const file of fileList) {
      const isPdfByExt = /\.pdf$/i.test(file.name);
      const supported =
        file.type === 'application/pdf' ||
        (file.type === '' && isPdfByExt) ||
        file.type === 'text/plain' ||
        (file.type === '' && /\.(txt|md|csv|json|html|xml)$/i.test(file.name)) ||
        file.name.endsWith('.docx');

      if (!supported) {
setFileError(`${t.errorUnsupported}: ${file.name}`);
        continue;
      }

      const fileContent = await new Promise((resolve) => {
        const reader = new FileReader();

        if (file.type === 'application/pdf' || (file.type === '' && isPdfByExt)) {
          reader.onload = async () => {
            try {
              const typedArray = new Uint8Array(reader.result);
              const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
              let text = '';
              for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                text += content.items.map(item => item.str).join(' ') + '\n';
              }
              resolve(text);
            } catch (err) {
setFileError(`${t.errorPdf}: ${err?.message || err}`);
              resolve(''); // ne pas bloquer la pile
            }
          };
          reader.readAsArrayBuffer(file);
        } else if (file.name.endsWith('.docx')) {
          reader.onload = async () => {
            try {
              const result = await mammoth.extractRawText({ arrayBuffer: reader.result });
              resolve(result.value);
            } catch (err) {
setFileError(`${t.errorDocx}: ${err?.message || err}`);
              resolve('');
            }
          };
          reader.readAsArrayBuffer(file);
        } else {
          reader.onload = e => resolve(e.target.result);
          reader.readAsText(file);
        }
      });

      newFiles.push({ name: file.name, content: fileContent, type: file.type || (isPdfByExt ? 'application/pdf' : '') });
    }

    setUploadedFiles(prev => [...prev, ...newFiles]);
  }

  const removeFile = (name) => {
    setUploadedFiles(prev => prev.filter(f => f.name !== name));
  };

  const exportChat = () => {
    const content = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}\n`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_${sessionId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onAutosize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const getTitleFor = (id) => localStorage.getItem(`chatbot_title_${id}`) || 'Untitled';

  // Persona dropdown label helper
  const personaLabel = (key) => personas[key]?.name || key;

  return (
    <div className="chatbot-container">
      {/* HEADER */}
      <header className="chat-header">
            <img src={logo} alt="Chatter AI logo" className="chat-logo" />

<h1 className="chat-title">{t.appTitle}</h1>
        <div className="header-actions">
        <button
  className="lang-toggle-btn"
  onClick={() => setLanguage(lang => (lang === 'fr' ? 'en' : 'fr'))}
  title={t.langToggleTooltip}
  aria-label={t.langToggleAria}
>
  🌐 {t.langShort}
</button>



<button onClick={exportChat} className="export-button">💾 {t.export}</button>
          <button
  onClick={() => setMuted(prev => !prev)}
  className="mute-toggle"
  title={muted ? t.unmute : t.mute}
  aria-label={muted ? t.unmute : t.mute}
>
  {muted ? '🔇' : '🔊'}
</button>

         <button
  onClick={() => setDarkMode(prev => !prev)}
  className="theme-toggle"
  title={darkMode ? t.themeDark : t.themeLight}
  aria-label={darkMode ? t.themeDark : t.themeLight}
>
  {darkMode ? '🌙' : '☀️'}
</button>

        </div>
      </header>

      {/* CONTENT: SIDEBAR + MAIN */}
<div className={`chat-content${historyCollapsed ? ' history-hidden' : ''}`}>
        {/* SIDEBAR */}
        <aside className={`history-sidebar ${historyCollapsed ? 'collapsed' : ''}`}>
          {/* NEW: collapse toggle above New chat */}
          {!historyCollapsed && (
  <button
  className="collapse-history-btn"
  onClick={() => setHistoryCollapsed(true)}
  aria-label={t.hideHistory}
  title={t.hideHistory}
  type="button"
>
  ❮
</button>

)}

<button className="new-chat-btn" onClick={newChat}>➕ {t.newChat}</button>
<h3 className="sidebar-title">{t.chatHistory}</h3>

          <ul id="historyList" className="history-list" hidden={historyCollapsed}>
            {sessionList.map(id => {
              const label = getTitleFor(id);
              return (
                <li key={id} className={`history-item ${sessionId === id ? 'active' : ''}`}>
                  <button
                    className="history-load"
                    onClick={() => setSessionId(id)}
                    title={label}
                  >
                    {label}
                  </button>
                  <button
  className="delete-chat-btn"
  onClick={(e) => { e.stopPropagation(); deleteChat(id); }}
  title={t.deleteChat}
  aria-label={t.deleteChat}
>
  ×
</button>

                </li>
              );
            })}
          </ul>
        </aside>
{historyCollapsed && (
 <button
  className="reveal-history-btn"
  onClick={() => setHistoryCollapsed(false)}
  aria-label={t.showHistory}
  title={t.showHistory}
  type="button"
>
  ❯
</button>

)}

        {/* MAIN COLUMN (centered narrow column) */}
        <main className="chat-main">
          <div className="chat-main-inner">
            {/* REPLACED PersonaSelector with a simple dropdown */}
            <div className="persona-row">
<label htmlFor="personaSelect" className="persona-label">{t.persona}</label>
<div style={{ flex: 1 }}>
<Select
  key={darkMode ? 'dark' : 'light'} 
  classNamePrefix="persona"
  inputId="personaSelect"
  options={personaOptions}
  value={personaOptions.find(opt => opt.value === selectedPersona)}
  onChange={opt => setSelectedPersona(opt.value)}
  isSearchable={false}
  styles={{
    control: base => ({
      ...base,
      minHeight: 46,
      fontWeight: 700,
      fontSize: '1.09rem',
      boxShadow: '0 3px 12px 0 rgba(79, 70, 229, 0.07)',
      borderColor: darkMode ? '#a5b4fc' : '#4f46e5',
      background: darkMode
        ? 'linear-gradient(90deg, #242449 0%, #232342 100%)'
        : 'linear-gradient(90deg, #ede9fe 0%, #f5f3ff 100%)',
      color: darkMode ? '#a5b4fc' : '#23232a',
      borderRadius: 22,
    }),
    option: (base, state) => ({
      ...base,
      background: state.isFocused
        ? (darkMode ? '#303075' : '#ede9fe')
        : (darkMode ? '#232342' : '#fff'),
      color: state.isSelected
        ? '#fff'
        : (darkMode ? '#a5b4fc' : '#23232a'),
      fontWeight: state.isSelected ? 800 : 600,
    }),
    singleValue: base => ({
      ...base,
      fontWeight: 800,
      fontSize: '1.13rem',
    }),
    menu: base => ({
      ...base,
      borderRadius: 18,
      background: darkMode ? '#232342' : '#fff',
      boxShadow: '0 4px 22px 0 rgba(80,90,255,0.10)',
    }),
  }}
/>

</div>

            </div>

            {/* message stream */}
            <div className="chat-history">
              {messages.map((msg, idx) => (
  <div key={idx} className={`msg ${msg.role}`}>
    <span style={{ fontWeight: 'bold' }}>
      {msg.role === 'user' ? `${t.you}:` : `${t.bot}:`}
    </span>
    <ReactMarkdown
      children={msg.content}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
    />
    {msg.files && msg.files.length > 0 && (
      <div className="file-preview">
        {msg.files.map((f) => (
          <span key={f.name} className="file-pill">
            {(FILE_ICONS[f.type] || '📎')} {f.name}
          </span>
        ))}
      </div>
    )}
  </div>
))}

              {partialResponse && (
                <div className="msg assistant">
                  <span>{t.bot}: </span>
                  <ReactMarkdown
                    children={partialResponse}
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                  />
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* input/search bar */}
            <form
              className="chat-input-form"
              onSubmit={sendMessage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
              }}
            >
<label className="paperclip-icon" title={t.uploadFiles} aria-label={t.uploadFiles}>
                📎
                <input
                  type="file"
                  multiple
                  onChange={(e) => handleFiles(e.target.files)}
                  className="hidden-file-input"
                />
              </label>

              <textarea
                value={input}
                disabled={loading}
                onChange={e => {
                  setInput(e.target.value);
                  onAutosize(e.target);
                }}
                onInput={e => onAutosize(e.target)}
                autoFocus
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) sendMessage(e);
                }}
              />

              <button type="submit">{t.send}</button>
            </form>

            {/* files under input */}
            {uploadedFiles.length > 0 && (
              <div className="file-preview">
                {uploadedFiles.map((f) => (
                  <span key={f.name} className="file-pill">
                    {(FILE_ICONS[f.type] || '📎')} {f.name}
<button onClick={() => removeFile(f.name)} aria-label={`${t.remove} ${f.name}`}>🗑️</button>
                  </span>
                ))}
              </div>
            )}

            {fileError && <div className="loading" role="alert">{fileError}</div>}
          </div>
        </main>
      </div>
      {isDragging && (
        <div className="global-drag-overlay">
          <div className="global-drag-overlay-inner">
            <span className="global-drag-icon">📁</span>
<span className="global-drag-text">{t.dropHere}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chatbot;
