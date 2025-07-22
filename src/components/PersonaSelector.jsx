import React from 'react';

function PersonaSelector({ personas, selectedPersona, onSelect, translations, language }) {
  return (
    <div className="persona-selector">
      {Object.entries(personas).map(([key, persona]) => (
        <button
          key={key}
          className={selectedPersona === key ? 'selected' : ''}
          onClick={() => onSelect(key)}
        >
          {translations[language].personas[persona.nameKey] || persona.nameKey}
        </button>
      ))}
    </div>
  );
}

export default PersonaSelector;
