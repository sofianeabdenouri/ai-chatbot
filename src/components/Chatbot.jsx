import React, { useState, useEffect } from 'react';
import { personas } from '../prompts/personas';
import { translations } from '../i18n/translations';
import PersonaSelector from './PersonaSelector';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_KEY;

function Chatbot() {
  const [selectedPersona, setSelectedPersona] = useState('pragmaticCoach');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('fr');
  const [voices, setVoices] = useState([]);
  const [muted, setMuted] = useState(() => localStorage.getItem('chatbot_muted') === 'true');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [customPrompt, setCustomPrompt] = useState(() =>
    personas[selectedPersona]?.prompt?.[language] || ''
  );
  const [tokenCount, setTokenCount] = useState(0);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('chatbot_darkmode') !== 'false');
  const [partialResponse, setPartialResponse] = useState('');
  const [tokenizer, setTokenizer] = useState(null);
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem(`chatbot_messages_${selectedPersona}`);
    return saved ? JSON.parse(saved) : [];
  });

  const t = translations[language];

  useEffect(() => {
    document.body.classList.remove('dark', 'light');
    document.body.classList.add(darkMode ? 'dark' : 'light');
    document.documentElement.style.height = '100%';
    document.body.style.minHeight = '100dvh';
  }, [darkMode]);

  useEffect(() => {
    const saved = localStorage.getItem(`chatbot_messages_${selectedPersona}`);
    setMessages(saved ? JSON.parse(saved) : []);
    setInput('');
    setCustomPrompt(personas[selectedPersona]?.prompt?.[language] || '');
  }, [selectedPersona, language]);

  useEffect(() => {
    async function loadTokenizer() {
      const { get_encoding } = await import('@dqbd/tiktoken');
      setTokenizer(get_encoding('cl100k_base'));
    }
    loadTokenizer();
  }, []);

  useEffect(() => {
    if (!tokenizer) return;
    const contextText = uploadedFiles.length
      ? uploadedFiles.map(f => `Fichier: "${f.name}"\nContenu:\n${f.content}`).join('\n\n') + '\n\n'
      : '';
    const combined = contextText + input.trim();
    const tokens = tokenizer.encode(combined).length;
    setTokenCount(tokens);
  }, [input, uploadedFiles, tokenizer]);

  useEffect(() => {
    localStorage.setItem(`chatbot_messages_${selectedPersona}`, JSON.stringify(messages));
  }, [messages, selectedPersona]);

  useEffect(() => {
    localStorage.setItem('chatbot_muted', muted);
  }, [muted]);

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      if (availableVoices.length) setVoices(availableVoices);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

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

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim() && uploadedFiles.length === 0) return;

    const contextPrefix = uploadedFiles.length
      ? `Tu as accès à ${uploadedFiles.length} fichier(s) joint(s).\n\n` +
        uploadedFiles.map(f => `Fichier: "${f.name}"\nContenu:\n${f.content}`).join('\n\n') + '\n\n'
      : '';

    const userInput = input.trim();
    const fullUserMessage = contextPrefix + userInput;
    const newMessage = { role: 'user', content: fullUserMessage };

    setMessages(msgs => [...msgs, { role: 'user', content: userInput }]);
    setInput('');
    setLoading(true);
    setPartialResponse('');

    try {
      const systemPrompt = customPrompt;
      if (!systemPrompt || typeof systemPrompt !== 'string') {
        setMessages(msgs => [...msgs, { role: 'assistant', content: "Erreur : prompt invalide." }]);
        setLoading(false);
        return;
      }

      const recentMessages = [...messages, newMessage].slice(-10);

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            ...recentMessages
          ],
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
          } catch (err) {}
        }
      }

      setPartialResponse('');
      setMessages(msgs => [...msgs, { role: 'assistant', content: fullText }]);
      speak(fullText);
    } catch (err) {
      setMessages(msgs => [...msgs, { role: 'assistant', content: "Erreur lors de la requête API." }]);
    }

    setLoading(false);
  }

  async function handleFiles(fileList) {
    const newFiles = [];
    for (const file of fileList) {
      let content = '';
      const reader = new FileReader();

      const fileContent = await new Promise((resolve) => {
        if (file.type === "application/pdf") {
          reader.onload = async () => {
            const typedArray = new Uint8Array(reader.result);
            const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              const pageText = content.items.map(item => item.str).join(' ');
              text += pageText + '\n';
            }
            resolve(text);
          };
          reader.readAsArrayBuffer(file);
        } else if (file.name.endsWith(".docx")) {
          reader.onload = async () => {
            const arrayBuffer = reader.result;
            const result = await mammoth.extractRawText({ arrayBuffer });
            resolve(result.value);
          };
          reader.readAsArrayBuffer(file);
        } else {
          reader.onload = (event) => resolve(event.target.result);
          reader.readAsText(file);
        }
      });

      newFiles.push({ name: file.name, content: fileContent, type: file.type });
    }
    setUploadedFiles(prev => [...prev, ...newFiles]);
  }

  const buttonStyle = {
    backgroundColor: darkMode ? '#444' : '#ddd',
    color: darkMode ? '#fff' : '#000',
    border: '1px solid',
    borderColor: darkMode ? '#666' : '#ccc',
    padding: '6px 10px',
    borderRadius: 4,
    cursor: 'pointer'
  };

  return (
    <div className="chatbot-container">
      <div style={{ marginBottom: 10 }}>
        <label>{t.langLabel}: </label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="language-select"
        >
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <button onClick={() => setMuted(prev => !prev)} style={buttonStyle}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button onClick={() => setDarkMode(prev => !prev)} style={buttonStyle}>
          {darkMode ? '🌙 Dark' : '☀️ Light'}
        </button>
      </div>

      <PersonaSelector
        personas={personas}
        selectedPersona={selectedPersona}
        onSelect={setSelectedPersona}
        translations={translations}
        language={language}
      />

      <textarea
        value={customPrompt}
        onChange={(e) => setCustomPrompt(e.target.value)}
        rows={5}
        className="custom-prompt"
      />

      <div className="chat-history">
        {messages.map((msg, idx) => (
          <div key={idx} className={`msg ${msg.role}`}>
            <span style={{ fontWeight: 'bold' }}>{msg.role === 'user' ? `${t.you}:` : `${t.bot}:`}</span>
            <ReactMarkdown children={msg.content} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} />
          </div>
        ))}
        {partialResponse && (
          <div className="msg assistant">
            <span>{t.bot}: </span>
            <ReactMarkdown children={partialResponse} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} />
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          type="text"
          value={input}
          disabled={loading}
          onChange={e => setInput(e.target.value)}
          autoFocus
          className="text-input"
        />
        <button type="submit" style={buttonStyle}>{t.send}</button>
        <button type="button" onClick={() => setMessages([])} style={buttonStyle}>{t.clear}</button>
      </form>

      <div className="token-count">
        {language === 'fr' ? `Jetons estimés : ${tokenCount}` : `Estimated tokens: ${tokenCount}`}
      </div>
    </div>
  );
}

export default Chatbot;
