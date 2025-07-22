// src/components/Chatbot.jsx
import React, { useState, useRef, useEffect } from 'react';
import { personas } from '../prompts/personas';
import { translations } from '../i18n/translations';
import PersonaSelector from './PersonaSelector';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_KEY;

function Chatbot() {
  const [selectedPersona, setSelectedPersona] = useState('pragmaticCoach');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('fr');
  const [voices, setVoices] = useState([]);
  const [muted, setMuted] = useState(() => localStorage.getItem('chatbot_muted') === 'true');
  const [fileUploadName, setFileUploadName] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const chatEndRef = useRef(null);

  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem(`chatbot_messages_${selectedPersona}`);
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    const saved = localStorage.getItem(`chatbot_messages_${selectedPersona}`);
    setMessages(saved ? JSON.parse(saved) : []);
    setInput('');
    setFileUploadName(null);
    setFileContent(null);
  }, [selectedPersona]);

  useEffect(() => {
    localStorage.setItem(`chatbot_messages_${selectedPersona}`, JSON.stringify(messages));
  }, [messages, selectedPersona]);

  useEffect(() => {
    localStorage.setItem('chatbot_muted', muted);
  }, [muted]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      if (availableVoices.length) {
        setVoices(availableVoices);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);
const t = translations[language]; 
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
    if (!input.trim() && !fileUploadName) return;

    const contextPrefix = fileContent
      ? `Tu as accès au contenu d'un fichier appelé "${fileUploadName}". Utilise son contenu pour répondre de manière pertinente et utile à la question qui suit. N'inclus pas le texte brut du fichier dans ta réponse.\n\nContenu:\n${fileContent}\n\n`
      : '';

    const userInput = fileUploadName || input.trim();
    const fullUserMessage = contextPrefix + userInput;

    const newMessage = { role: 'user', content: fullUserMessage };

    setMessages((msgs) => [
      ...msgs,
      { role: 'user', content: userInput }
    ]);

    setInput('');
    setFileUploadName(null);
    setFileContent(null);
    setLoading(true);

    try {
      const systemPrompt = personas[selectedPersona]?.prompt?.[language];
      if (!systemPrompt || typeof systemPrompt !== "string") {
        console.error("Prompt invalide:", systemPrompt);
        setMessages(msgs => [...msgs, { role: 'assistant', content: "Erreur : prompt invalide." }]);
        setLoading(false);
        return;
      }

      const recentMessages = [...messages, newMessage].slice(-10);

      const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            ...recentMessages
          ],
          max_tokens: 180,
        }),
      });

      const data = await apiRes.json();

      if (data.error) {
        console.error("OpenAI API error:", data.error);
        throw new Error(data.error.message);
      }

      const answer = data.choices?.[0]?.message?.content || "Erreur API";
      setMessages(msgs => [...msgs, { role: 'assistant', content: answer }]);
      speak(answer);
    } catch (err) {
      console.error(err);
      setMessages(msgs => [...msgs, { role: 'assistant', content: "Erreur lors de la requête API." }]);
    }

    setLoading(false);
  }

  function handleClear() {
    setMessages([]);
    localStorage.removeItem(`chatbot_messages_${selectedPersona}`);
  }

  async function handleFile(file) {
    if (!file) return;
    setFileUploadName(file.name);
    const reader = new FileReader();

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
        setFileContent(text);
      };
      reader.readAsArrayBuffer(file);
    } else if (file.name.endsWith(".docx")) {
      reader.onload = async () => {
        const arrayBuffer = reader.result;
        const result = await mammoth.extractRawText({ arrayBuffer });
        setFileContent(result.value);
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (event) => setFileContent(event.target.result);
      reader.readAsText(file);
    }
  }

  return (
    <div className="chatbot-container">
      <div className="language-selector" style={{ marginBottom: 10 }}>
        <label>{t.langLabel}: </label>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </div>

      <div className="tts-toggle" style={{ marginBottom: 10 }}>
        <button onClick={() => setMuted(prev => !prev)} className="tts-btn" title="Activer/Désactiver voix">
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      <PersonaSelector
        personas={personas}
        selectedPersona={selectedPersona}
        onSelect={setSelectedPersona}
        translations={translations}
        language={language}
      />

      <div className="chat-history">
        {messages.map((msg, idx) => (
          <div key={idx} className={`msg ${msg.role}`}>
            <span>{msg.role === 'user' ? `${t.you}:` : `${t.bot}:`} </span>
            {msg.content}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {fileUploadName && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 18, marginRight: 8 }}>
            {fileUploadName.endsWith('.pdf') ? '📄' :
             fileUploadName.endsWith('.docx') ? '📃' : '📝'}
          </span>
          <span style={{ marginRight: 8 }}>{fileUploadName}</span>
          <button onClick={() => { setFileUploadName(null); setFileContent(null); }}>🗑️</button>
        </div>
      )}

      <form onSubmit={sendMessage} className="chat-input-form">
        <input
          type="text"
          value={input}
          disabled={loading}
          onChange={e => setInput(e.target.value)}
          placeholder={fileUploadName || t.inputPlaceholder}
          autoFocus
        />
        <button type="submit" disabled={loading || (!input.trim() && !fileUploadName)}>{t.send}</button>
        <button type="button" onClick={handleClear} style={{ marginLeft: 8 }}>{t.clear}</button>
      </form>

      <div
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onDragOver={(e) => e.preventDefault()}
        style={{
          border: '2px dashed #ccc',
          padding: '16px',
          marginTop: 10,
          textAlign: 'center',
          borderRadius: 6,
          cursor: 'pointer'
        }}
        onClick={() => document.getElementById('fileInput').click()}
      >
        {t.fileDropLabel}
        <input
          id="fileInput"
          type="file"
          accept=".txt,.md,.csv,.json,.log,.html,.xml,.pdf,.docx"
          onChange={(e) => handleFile(e.target.files[0])}
          style={{ display: 'none' }}
        />
      </div>

      {loading && <div className="loading">⏳...</div>}
    </div>
  );
}

export default Chatbot;
