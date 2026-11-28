export const RECOVERY_ACCEPTED_MESSAGE = 'Se existir uma conta com este e-mail, confira sua caixa de entrada e a pasta de spam para continuar a redefinição.';
export const RECOVERY_UNAVAILABLE_MESSAGE = 'Não foi possível solicitar a redefinição agora. Tente novamente mais tarde ou procure o atendimento da loja.';

// Never disclose account existence or forward provider errors to the customer.
// A rejected request must not be presented as a delivered email.
export async function requestPasswordRecovery(email, request) {
    try {
        await request(email);
        return { accepted: true, message: RECOVERY_ACCEPTED_MESSAGE };
    } catch {
        return { accepted: false, message: RECOVERY_UNAVAILABLE_MESSAGE };
    }
}
