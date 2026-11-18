import { describe, expect, it } from 'vitest';

import { getAccountDisplayLabel, getDeliverableEmail, getIrrifarmAccountId } from '@/lib/irrifarm-user';

describe('Irrifarm synthetic user email', () => {
	it('renders the Irrifarm account id instead of the internal placeholder', () => {
		expect(getIrrifarmAccountId('irrifarm-470@users.invalid')).toBe('470');
		expect(getAccountDisplayLabel('irrifarm-470@users.invalid')).toBe('Irrifarm account · ID 470');
	});

	it('does not expose a synthetic address as a deliverable email', () => {
		expect(getDeliverableEmail('irrifarm-470@users.invalid')).toBeUndefined();
	});

	it('leaves regular email addresses unchanged', () => {
		expect(getIrrifarmAccountId('person@example.com')).toBeNull();
		expect(getAccountDisplayLabel('person@example.com')).toBe('person@example.com');
		expect(getDeliverableEmail('person@example.com')).toBe('person@example.com');
	});
});
