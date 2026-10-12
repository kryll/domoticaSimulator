import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { App } from './App';
describe('App', () => {
    it('muestra el título', () => {
        render(_jsx(App, {}));
        expect(screen.getByRole('heading', { name: 'HA Simulator' })).toBeInTheDocument();
    });
});
