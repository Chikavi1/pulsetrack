 
    import { PulseTrack } from '../dist/index.js';
 
    PulseTrack.init({ businessId: '080fbac4-2aa8-4016-89ee-e339bd3c1c16' });
    const tracker = PulseTrack.tracker();

    const log = (msg) => {
      const logs = document.getElementById('logs');
      logs.innerHTML += `${new Date().toISOString()} - ${msg}<br/>`;
      logs.scrollTop = logs.scrollHeight;
    };

    // Track page view
    tracker.track('page_view', {
      page_title: 'Test Page',
      page_url: window.location.href,
      referrer: document.referrer
    });

    // Button Events
    document.getElementById('btn-click').addEventListener('click', () => {
      tracker.track('button_click', { 
        button_id: 'btn-click',
        button_text: 'Click Event',
        page_section: 'action_buttons'
      });
      log('Tracked button click');
    });

    // Double click event
    document.getElementById('btn-double-click').addEventListener('dblclick', () => {
      tracker.track('button_double_click', { 
        button_id: 'btn-double-click',
        page_section: 'action_buttons'
      });
      log('Tracked double click');
    });

    // Mouseover event
    document.getElementById('btn-mouseover').addEventListener('mouseover', () => {
      tracker.track('button_hover', { 
        button_id: 'btn-mouseover',
        page_section: 'action_buttons'
      });
      log('Tracked button hover');
    });

    // Show logs
    document.getElementById('btn-logs').addEventListener('click', () => {
      log('Current tracker data: ' + JSON.stringify(PulseTrack.tracker().getData()));
    });

    // Form submission
    document.getElementById('test-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = Object.fromEntries(new FormData(e.target));
      tracker.track('form_submit', {
        form_id: 'test-form',
        form_name: 'Test Form',
        ...formData
      });
      log(`Form submitted: ${JSON.stringify(formData)}`);
    });

    // Input changes with debounce
    let inputTimeout;
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      el.addEventListener('input', (e) => {
        clearTimeout(inputTimeout);
        inputTimeout = setTimeout(() => {
          tracker.track('form_input', { 
            field_name: e.target.name || e.target.id,
            field_type: e.target.type,
            value: e.target.value,
            form_id: e.target.form?.id || 'n/a'
          });
          log(`Input changed: ${e.target.name || e.target.id} = ${e.target.value}`);
        }, 500);
      });
    });

    // Search functionality
    const searchBox = document.getElementById('search-box');
    const searchBtn = document.getElementById('btn-search');
    const searchSuggestions = document.getElementById('search-suggestions');
    

    // Login
    document.getElementById('btn-login').addEventListener('click', () => {
      localStorage.setItem('tracker_user','user123');
      log('Tracked login');
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
      localStorage.removeItem('tracker_user');
      log('Tracked logout');
    });

    // Error
        document.getElementById('btn-error').addEventListener('click', () => {
      throw new Error('Error de prueba 1');
    });

    // Error 2
    document.getElementById('btn-error2').addEventListener('click', () => {
      const obj = null;
      obj.nonExistentMethod(); // Esto causará un TypeError
    });

    // Error 3
    document.getElementById('btn-error3').addEventListener('click', () => {
      // Error de referencia a variable no definida
      nonExistentVariable;
    });

    // Track search
    searchBtn.addEventListener('click', () => {
      const query = searchBox.value.trim();
      if (query) {
        tracker.track('search', { 
          query: query,
          source: 'search_box',
          result_count: Math.floor(Math.random() * 50) // Simulate result count
        });
        log(`Search executed: ${query}`);
      }
    });

    // Search suggestions
    searchBox.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (query.length > 2) {
        // Simulate API call for suggestions
        const suggestions = [
          `${query} products`,
          `${query} 2023`,
          `best ${query}`,
          `buy ${query} online`
        ];
        
        searchSuggestions.innerHTML = suggestions.map(s => 
          `<div class="p-2 hover:bg-gray-100 cursor-pointer">${s}</div>`
        ).join('');
        searchSuggestions.classList.remove('hidden');
        
        tracker.track('search_suggest', { query: query });
      } else {
        searchSuggestions.classList.add('hidden');
      }
    });

    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
      if (!searchBox.contains(e.target) && !searchSuggestions.contains(e.target)) {
        searchSuggestions.classList.add('hidden');
      }
    });

    // Image click tracking
    document.querySelectorAll('img[data-img-id]').forEach(img => {
      img.addEventListener('click', (e) => {
        const imgId = e.target.getAttribute('data-img-id');
        tracker.track('image_click', {
          image_id: imgId,
          alt_text: e.target.alt,
          source: 'gallery'
        });
        log(`Image clicked: ${imgId} (${e.target.alt})`);
      });
    });

    // Product card interactions
    document.querySelectorAll('[data-product-id]').forEach(card => {
      const productId = card.getAttribute('data-product-id');
      const productName = card.querySelector('h3')?.textContent || 'Unknown Product';
      const productPrice = card.querySelector('span')?.textContent || '0';
      
      // Track product view when card comes into viewport
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            tracker.track('product_view', {
              product_id: productId,
              name: productName,
              price: productPrice,
              currency: 'USD',
              position: Array.from(card.parentNode.children).indexOf(card) + 1
            });
            log(`Product viewed: ${productName}`);
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.5 });
      
      observer.observe(card);
      
      // Track add to cart
      const addToCartBtn = card.querySelector('button');
      if (addToCartBtn) {
        addToCartBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          tracker.track('add_to_cart', {
            product_id: productId,
            name: productName,
            price: productPrice,
            currency: 'USD',
            quantity: 1
          });
          
          // Show feedback
          const originalText = addToCartBtn.textContent;
          addToCartBtn.textContent = 'Added! ✓';
          addToCartBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600');
          addToCartBtn.classList.add('bg-green-500', 'hover:bg-green-600');
          
          setTimeout(() => {
            addToCartBtn.textContent = originalText;
            addToCartBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
            addToCartBtn.classList.add('bg-blue-500', 'hover:bg-blue-600');
          }, 2000);
          
          log(`Added to cart: ${productName}`);
        });
      }
    });

    // Rating system
    const ratingStars = document.querySelectorAll('#rating-stars button');
    ratingStars.forEach((star, index) => {
      star.addEventListener('click', () => {
        const rating = index + 1;
        
        // Update UI
        ratingStars.forEach((s, i) => {
          s.textContent = i <= index ? '★' : '☆';
        });
        
        // Track rating
        tracker.track('product_rating', {
          rating: rating,
          max_rating: 5,
          product_id: 'demo-product-123',
          product_name: 'Demo Product'
        });
        
        log(`Rated ${rating} stars`);
      });
    });

    // Track time on page
    let pageStartTime = Date.now();
    const trackTimeOnPage = () => {
      const timeSpent = Math.floor((Date.now() - pageStartTime) / 1000);
      tracker.track('time_on_page', {
        seconds: timeSpent,
        page_url: window.location.href
      });
      log(`Time on page: ${timeSpent} seconds`);
    };
    
    // Track when page is hidden or closed
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        trackTimeOnPage();
      }
    });
    
    // Track before unload
    window.addEventListener('beforeunload', trackTimeOnPage);

   

    // Initial log
    log('PulseTrack ready - Interactive demo page loaded');
 