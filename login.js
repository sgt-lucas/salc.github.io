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

        // O FastAPI espera os dados de login no formato 'form data'.
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

            if (!response.ok) {
                // Tenta ler a mensagem de erro detalhada do backend.
                const data = await response.json();
                throw new Error(data.detail || 'Falha na autenticação');
            }

            // Se a resposta for OK, o backend já definiu o cookie HttpOnly.
            // Não é necessário guardar tokens no localStorage. Apenas redirecionamos.
            window.location.href = 'index.html';

        } catch (error) {
            errorMessage.textContent = `Erro: ${error.message}`;
        } finally {
            // Reabilita o botão, independentemente do resultado.
            submitButton.disabled = false;
            submitButton.textContent = 'Entrar';
        }
    });
});
