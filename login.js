document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');
    
    // IMPORTANTE: Verifique se esta URL corresponde exatamente à URL do seu backend no Render.
    const API_URL = 'https://salc.onrender.com';

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessage.textContent = '';
        const submitButton = loginForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Autenticando...';

        const username = e.target.username.value;
        const password = e.target.password.value;

        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        try {
            const response = await fetch(`${API_URL}/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Falha na autenticação');
            }

            // Guarda o token de acesso no localStorage
            localStorage.setItem('accessToken', data.access_token);
            
            // Redireciona o utilizador para a página principal do sistema
            window.location.href = 'index.html';

        } catch (error) {
            errorMessage.textContent = `Erro: ${error.message}`;
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Entrar';
        }
    });
});
