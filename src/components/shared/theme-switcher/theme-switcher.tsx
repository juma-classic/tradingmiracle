import React, { useState, useEffect } from 'react';
import './theme-switcher.scss';

interface ThemeOption {
    id: string;
    name: string;
    description: string;
    preview: string;
}

const availableThemes: ThemeOption[] = [
    {
        id: 'light',
        name: 'Light',
        description: 'Clean and bright interface',
        preview: '☀️'
    },
    {
        id: 'dark',
        name: 'Dark',
        description: 'Easy on the eyes',
        preview: '🌙'
    },
    {
        id: 'ocean',
        name: 'Ocean Blue',
        description: 'Deep blue professional theme',
        preview: '🌊'
    },
    {
        id: 'sunset',
        name: 'Sunset Purple',
        description: 'Warm purple gradient theme',
        preview: '🌅'
    }
];

export const ThemeSwitcher: React.FC = () => {
    const [currentTheme, setCurrentTheme] = useState<string>('light');
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        // Load saved theme from localStorage
        const savedTheme = localStorage.getItem('selected-theme') || 'light';
        setCurrentTheme(savedTheme);
        applyTheme(savedTheme);
    }, []);

    const applyTheme = (themeId: string) => {
        const body = document.body;
        
        // Remove all theme classes
        body.classList.remove('theme--light', 'theme--dark', 'theme--ocean', 'theme--sunset');
        
        // Add the selected theme class
        body.classList.add(`theme--${themeId}`);
        
        // Save to localStorage
        localStorage.setItem('selected-theme', themeId);
    };

    const handleThemeChange = (themeId: string) => {
        setCurrentTheme(themeId);
        applyTheme(themeId);
        setIsOpen(false);
    };

    const currentThemeData = availableThemes.find(theme => theme.id === currentTheme);

    return (
        <div className="theme-switcher">
            <button 
                className="theme-switcher__trigger"
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Change theme"
            >
                <span className="theme-switcher__preview">
                    {currentThemeData?.preview}
                </span>
                <span className="theme-switcher__name">
                    {currentThemeData?.name}
                </span>
                <span className="theme-switcher__arrow">
                    {isOpen ? '▲' : '▼'}
                </span>
            </button>

            {isOpen && (
                <div className="theme-switcher__dropdown">
                    {availableThemes.map((theme) => (
                        <button
                            key={theme.id}
                            className={`theme-switcher__option ${
                                currentTheme === theme.id ? 'theme-switcher__option--active' : ''
                            }`}
                            onClick={() => handleThemeChange(theme.id)}
                        >
                            <span className="theme-switcher__option-preview">
                                {theme.preview}
                            </span>
                            <div className="theme-switcher__option-content">
                                <span className="theme-switcher__option-name">
                                    {theme.name}
                                </span>
                                <span className="theme-switcher__option-description">
                                    {theme.description}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}; 