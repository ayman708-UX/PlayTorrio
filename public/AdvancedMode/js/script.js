// Playtorrio Intro Animation Script

document.addEventListener('DOMContentLoaded', () => {
    const introContainer = document.getElementById('introContainer');
    
    if (!introContainer) return;

    // Check if intro should be skipped
    if (sessionStorage.getItem('skipIntro') === 'true') {
        introContainer.style.display = 'none';
        document.body.style.overflow = 'auto';
        
        // Show main content immediately
        const mainContent = document.getElementById('mainContent');
        if (mainContent) mainContent.style.opacity = '1';
        
        console.log('⏩ Intro skipped');
        
        // Consume the flag so it plays again on refresh
        sessionStorage.removeItem('skipIntro');
        return;
    }

    // Always show intro if not skipped
    introContainer.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Play intro music from DOM element
    const introMusic = document.getElementById('introMusic');
    if (introMusic) {
        introMusic.volume = 1.0;
        
        const playAudio = () => {
            introMusic.play().then(() => {
                console.log('🔊 Intro music started');
                // Clean up all trigger listeners
                events.forEach(event => window.removeEventListener(event, playAudio));
            }).catch(() => {
                // Keep trying silently
            });
        };

        // Aggressive trigger list
        const events = ['mousedown', 'keydown', 'touchstart', 'mousemove', 'wheel', 'scroll'];
        events.forEach(event => window.addEventListener(event, playAudio, { once: true }));

        // Initial attempt
        playAudio();

        // Sync music fade-out with CSS animation (starts at 4s)
        setTimeout(() => {
            const fadeOutInterval = setInterval(() => {
                if (introMusic.volume > 0.05) {
                    introMusic.volume -= 0.05;
                } else {
                    introMusic.pause();
                    clearInterval(fadeOutInterval);
                }
            }, 50);
        }, 4000);
    }

    // After intro animation (5s total), hide intro
    setTimeout(() => {
        introContainer.style.display = 'none';
        document.body.style.overflow = 'auto';
        
        // Show main content
        const mainContent = document.getElementById('mainContent');
        if (mainContent) mainContent.style.opacity = '1';
    }, 5000);
    
    // Add particle effect on mouse move during intro
    let particles = [];
    const maxParticles = 50;
    
    function createParticle(x, y) {
        if (particles.length >= maxParticles) {
            const oldParticle = particles.shift();
            oldParticle.remove();
        }
        
        const particle = document.createElement('div');
        particle.style.position = 'fixed';
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        particle.style.width = '4px';
        particle.style.height = '4px';
        particle.style.borderRadius = '50%';
        particle.style.background = `rgba(${Math.random() * 100 + 139}, ${Math.random() * 50 + 92}, 246, 0.8)`;
        particle.style.pointerEvents = 'none';
        particle.style.zIndex = '9998';
        particle.style.boxShadow = '0 0 10px rgba(139, 92, 246, 0.8)';
        
        introContainer.appendChild(particle);
        particles.push(particle);
        
        // Animate particle
        let opacity = 1;
        let scale = 1;
        const interval = setInterval(() => {
            opacity -= 0.02;
            scale += 0.05;
            particle.style.opacity = opacity;
            particle.style.transform = `scale(${scale})`;
            
            if (opacity <= 0) {
                clearInterval(interval);
                particle.remove();
                particles = particles.filter(p => p !== particle);
            }
        }, 30);
    }
    
    let mouseTimeout;
    introContainer.addEventListener('mousemove', (e) => {
        clearTimeout(mouseTimeout);
        mouseTimeout = setTimeout(() => {
            createParticle(e.clientX, e.clientY);
        }, 50);
    });
    
    console.log('🎬 Playtorrio - Your Cinema Universe');
});
